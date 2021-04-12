"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
const CoinTable_1 = require("./CoinTable");
const Wallet_1 = require("./Wallet");
const Key_1 = require("./Key");
const http = require("http");
const node_fetch_1 = require("node-fetch");
const serveStatic = require("serve-static");
// eslint-disable-next-line @typescript-eslint/no-var-requires
let WebSocket = require("ws"); // Must be a variable to work in the browser
if (typeof self !== "undefined" && typeof window === "undefined") {
    throw new Error("Coin Table is currently unavailable in web workers due to WebRTC limitations");
}
const inBrowser = typeof window !== "undefined";
if (inBrowser) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    WebSocket = window.WebSocket;
}
class Network extends utils_1.EventTarget {
    constructor(wallet) {
        super();
        this.connectedAddresses = new Set();
        this.disposed = false;
        this.wallet = wallet;
    }
    dispose() {
        this.disposed = true;
        this.internalDispose();
    }
}
(function (Network) {
    class Local extends Network {
        constructor() {
            super(...arguments);
            this.connections = {};
        }
        connect(node) {
            if (this.disposed) {
                return;
            }
            const connectionAddress = node.wallet.public.address;
            if (connectionAddress === this.wallet.public.address) {
                return;
            }
            this.connections[connectionAddress] = node;
            this.connectedAddresses.add(connectionAddress);
        }
        async requestBalance(balanceAddress, connectionAddress) {
            var _a;
            const connection = this.connections[connectionAddress];
            return (_a = connection.table.balances[balanceAddress]) !== null && _a !== void 0 ? _a : null;
        }
        async requestTable(connectionAddress) {
            const connection = this.connections[connectionAddress];
            return connection === null || connection === void 0 ? void 0 : connection.table;
        }
        async shareTable(table, excluding) {
            await new Promise(r => setTimeout(r, 250));
            await Promise.all(Array.from(this.connectedAddresses).map(connId => {
                if (connId === excluding) {
                    return;
                }
                const recieverNetwork = this.connections[connId].network;
                return recieverNetwork.dispatchEvent("tabledigest", { digest: table.digest, from: { address: this.wallet.public.address } });
            }));
        }
        async shareTransaction(transaction, excluding) {
            await new Promise(r => setTimeout(r, 250));
            await Promise.all(Array.from(this.connectedAddresses).map(connId => {
                if (connId === excluding) {
                    return;
                }
                const recieverNetwork = this.connections[connId].network;
                return recieverNetwork.dispatchEvent("transaction", { transaction, from: this.wallet.public.address });
            }));
        }
        async sendPendingTransaction(transaction) {
            var _a, _b;
            let sendTo = null;
            if (transaction.sender === this.wallet.public.address) {
                sendTo = transaction.reciever;
            }
            else if (transaction.reciever === this.wallet.public.address) {
                sendTo = transaction.sender;
            }
            if (!sendTo || !this.connections[sendTo]) {
                return null;
            }
            const recieverNetwork = this.connections[sendTo].network;
            await new Promise(r => setTimeout(r, 250));
            return (_b = await ((_a = recieverNetwork.onRecievingPendingTransaction) === null || _a === void 0 ? void 0 : _a.call(recieverNetwork, transaction, this.wallet.public.address))) !== null && _b !== void 0 ? _b : null;
        }
        internalDispose() {
            this.connections = {};
            this.connectedAddresses = new Set();
        }
    }
    Network.Local = Local;
    class Connection extends utils_1.EventTarget {
        constructor(connectionAddress, uniqueId, parentNetwork) {
            super();
            this.state = "connecting";
            this.neighbors = new Map();
            this.pendingResponses = {};
            console.log("Connection created", connectionAddress, uniqueId);
            this.address = connectionAddress;
            this.uniqueId = uniqueId;
            this.network = parentNetwork;
            const othersPublic = new Key_1.default.Public(this.address);
            const keyMaterial = utils_1.Buffer.concat(this.network.wallet.private.derive(othersPublic), utils_1.Convert.int64ToBuffer(this.network.uniqueId + this.uniqueId));
            this.sharedEncryptionKey = new Uint8Array(utils_1.hash(keyMaterial));
        }
        insertNeighbor(address, uniqueId) {
            const currentIds = this.neighbors.get(address);
            if (currentIds) {
                currentIds.push(uniqueId);
            }
            else {
                this.neighbors.set(address, [uniqueId]);
            }
        }
        deleteNeighbor(address, uniqueId) {
            const currentIds = this.neighbors.get(address);
            if (currentIds) {
                const idIndex = currentIds.indexOf(uniqueId);
                if (idIndex >= 0) {
                    currentIds.splice(idIndex, 1);
                }
            }
        }
        internalOpenHandler() {
            if (this.state !== "connecting") {
                return;
            } // Only run if state is currently in "connecting"
            console.log("Connection opened", this.address, this.uniqueId);
            const connections = this.network["connections"];
            const connectionBuffers = [];
            this.network.connectedAddresses.forEach(addr => {
                connections[addr].forEach(connection => {
                    connectionBuffers.push(utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(addr, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(connection.uniqueId)));
                });
            });
            this.send("connections", utils_1.Buffer.concat(...connectionBuffers));
            const connectionInfoBuffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(this.uniqueId));
            let serverData = null;
            let host;
            if (this instanceof WebSocketConnection && this.serverHost) {
                host = this.serverHost;
                serverData = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(this.uniqueId), utils_1.Convert.stringToBuffer(host));
            }
            Object.keys(connections).forEach(addr => {
                if (addr === this.address) {
                    return;
                }
                connections[addr].forEach(connection => {
                    if (serverData) {
                        connection.send("server_connected", serverData);
                    }
                    else {
                        connection.send("new_connection", connectionInfoBuffer);
                    }
                    if (connection instanceof WebSocketConnection && connection.serverHost) {
                        const serverData = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(connection.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(connection.uniqueId), utils_1.Convert.stringToBuffer(connection.serverHost));
                        this.send("server_connected", serverData);
                    }
                });
            });
            this.network.connectedAddresses.add(this.address);
            this.send("new_table", this.network.node.table.digest);
            this.state = "open";
            this.dispatchEvent("open");
            this.network.dispatchEvent("connection", { address: this.address, host });
        }
        internalClosedHandler() {
            if (this.state !== "open") {
                this.state = "closed";
                return;
            } // Only run if connection is open
            console.log("Connection closed", this.address, this.uniqueId);
            this.network.deleteConnection(this.address, this);
            this.state = "closed";
            this.dispatchEvent("close");
            this.network.dispatchEvent("disconnection", { address: this.address });
            if (this.network instanceof Client) {
                this.network.shareWithAll("connection_closed", utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(this.uniqueId)));
            }
        }
        send(header, body, encrypted) {
            if (encrypted) {
                body = utils_1.XorCipher.encrypt(body, this.sharedEncryptionKey);
            }
            this.internalSend(this.createMessage(header, body));
            console.log("Sent message to", this.address.slice(0, 8), header, encrypted ? "encrypted" : "not encrypted");
        }
        sendAndWaitForResponse(header, body, responseHeader, encrypt, timeout = 10000) {
            this.send(header, body, encrypt);
            return new Promise((resolve) => {
                this.pendingResponses[responseHeader] = resolve;
                setTimeout(() => {
                    this.pendingResponses[responseHeader] = undefined;
                    resolve(null);
                }, timeout);
            });
        }
        async internalMessageHandler(message) {
            let data;
            try {
                data = this.destructureMessage(message);
            }
            catch (err) {
                console.error("Invalid message recieved from", this.address.slice(0, 8), err);
                return;
            }
            console.log("Recieved message from", this.address.slice(0, 8), data.header, data.verified ? "verified" : "not verified");
            if (data.verified) {
                try {
                    await this.handleMessage(data);
                }
                catch (err) {
                    console.error("Failed to handle message from", this.address.slice(0, 8), data.header, err);
                }
            }
            const pendingResolution = this.pendingResponses[data.header];
            if (pendingResolution) {
                pendingResolution(data);
                this.pendingResponses[data.header] = undefined;
            }
            this.dispatchEvent("message", data);
        }
        async handleMessage(data) {
            var _a, _b;
            if (data.header === "get_balance") {
                const address = utils_1.Convert.Base58.encode(data.body);
                const balance = this.network.node.table.balances[address];
                const responseHeader = "response_balance_" + address.slice(0, 8);
                this.send(responseHeader, utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(balance.amount), utils_1.Convert.int64ToBuffer(balance.timestamp), utils_1.Convert.Base58.decodeBuffer(balance.signature)));
            }
            else if (data.header === "get_table") {
                const tableBuf = this.network.node.table.exportBuffer();
                this.send("response_table", tableBuf);
            }
            else if (data.header === "new_table") {
                this.network.dispatchEvent("tabledigest", {
                    digest: data.body,
                    from: {
                        address: this.address,
                        id: this.uniqueId
                    }
                });
            }
            else if (data.header === "new_transaction") {
                let startIndex = 0;
                const sender = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const senderSignature = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.SIG_LENGTH));
                const senderTransactionSignature = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.SIG_LENGTH));
                const reciever = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const recieverSignature = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.SIG_LENGTH));
                const amount = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 8));
                const timestamp = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 8));
                const transaction = {
                    sender, senderSignature, senderTransactionSignature, reciever, recieverSignature, amount, timestamp
                };
                this.network.dispatchEvent("transaction", { transaction, from: this.address });
            }
            else if (data.header === "pending_transaction") {
                data.body = utils_1.XorCipher.decrypt(data.body, this.sharedEncryptionKey);
                let startIndex = 0;
                const sender = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const senderSignature = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.SIG_LENGTH));
                const senderTransactionSignature = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.SIG_LENGTH));
                const reciever = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const amount = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 8));
                const timestamp = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 8));
                const pendingTransaction = {
                    sender, senderSignature, senderTransactionSignature, reciever, amount, timestamp
                };
                const response = await ((_b = (_a = this.network).onRecievingPendingTransaction) === null || _b === void 0 ? void 0 : _b.call(_a, pendingTransaction, this.address));
                if (response) {
                    const recieverSignature = utils_1.Convert.Base58.decodeBuffer(response.recieverSignature);
                    this.send("pending_transaction_signature", recieverSignature, true);
                }
                else {
                    this.send("pending_transaction_signature", new Uint8Array());
                }
            }
            else if (data.header === "server_connected" && this.network instanceof Client) {
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(0, Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(Key_1.default.Public.LENGTH, Key_1.default.Public.LENGTH + 4));
                this.insertNeighbor(connectionAddress, uniqueId);
                let ignoreProbability = 0;
                if (!(this.network instanceof Server)) {
                    const totalConnections = this.network.totalConnections;
                    ignoreProbability = totalConnections / 100;
                }
                const currentConnection = this.network.getConnection(connectionAddress, uniqueId);
                const alreadyConnected = currentConnection && currentConnection.state !== "closed";
                if (!alreadyConnected && Math.random() > ignoreProbability) {
                    const host = utils_1.Convert.bufferToString(data.body.subarray(Key_1.default.Public.LENGTH + 4));
                    console.log("New server", connectionAddress.slice(0, 8), host);
                    this.network.connectToWebSocket(host, connectionAddress);
                }
            }
            else if (data.header === "connections") {
                const connections = [];
                let startIndex = 0;
                while (startIndex < data.body.byteLength) {
                    const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                    const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 4));
                    connections.push(connectionAddress + "/" + uniqueId);
                    this.insertNeighbor(connectionAddress, uniqueId);
                }
                console.log("connections", connections);
            }
            else if (data.header === "new_connection" && this.network instanceof Client && !(this.network instanceof Server)) {
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(0, Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(Key_1.default.Public.LENGTH));
                this.insertNeighbor(connectionAddress, uniqueId);
                console.log("Recieved connection event for", connectionAddress.slice(0, 8), "from", this.address.slice(0, 8));
                const connection = this.network.getConnection(connectionAddress, uniqueId);
                if (!connection || connection.state === "closed") {
                    const totalConnections = this.network.totalConnections;
                    const ignoreProbability = totalConnections / 100;
                    if (Math.random() > ignoreProbability) {
                        this.signalForWebRTCConnection(connectionAddress, uniqueId);
                    }
                }
            }
            else if (data.header === "connection_closed" && this.network instanceof Client) {
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(0, Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(Key_1.default.Public.LENGTH));
                this.deleteNeighbor(connectionAddress, uniqueId);
            }
            else if (data.header === "rtc_offer_forward" && this.network instanceof Server) {
                let startIndex = 0;
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 4));
                console.log("Recieved WebRTC signaling message from ", this.address.slice(0, 8), "for", connectionAddress.slice(0, 8));
                const connection = this.network.getConnection(connectionAddress, uniqueId); //this.network.connections[connectionAddress]
                const responseHeader = "rtc_answer_" + this.address.slice(0, 8) + "-" + connectionAddress.slice(0, 8);
                const message = data.body;
                message.set(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH));
                message.set(utils_1.Convert.int32ToBuffer(this.uniqueId), Key_1.default.Public.LENGTH);
                const response = await (connection === null || connection === void 0 ? void 0 : connection.sendAndWaitForResponse("rtc_offer", message, responseHeader));
                if (response) {
                    this.send("rtc_answer_" + connectionAddress.slice(0, 8), response.body);
                }
            }
            else if (data.header === "rtc_offer" && this instanceof WebSocketConnection && !(this.network instanceof Server)) {
                let startIndex = 0;
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 4));
                const connection = this.network.getConnection(connectionAddress, uniqueId);
                if (!connection || connection.state === "closed") {
                    console.log("Recieved RTC offer from", connectionAddress.slice(0, 8), "via", this.address.slice(0, 8));
                    const peerConnection = new RTCPeerConnection({
                        iceServers: [{ urls: "stun:stun2.l.google.com:19302" }]
                    });
                    const rtcConnection = new WebRTCConnection(peerConnection, connectionAddress, uniqueId, this.network);
                    this.network.insertConnection(connectionAddress, rtcConnection);
                    const otherKey = new Key_1.default.Public(connectionAddress);
                    const sharedKey = this.network.wallet.private.derive(otherKey);
                    const offerSdp = utils_1.Convert.bufferToString(utils_1.XorCipher.decrypt(data.body.subarray(startIndex), sharedKey), true);
                    peerConnection.setRemoteDescription({
                        sdp: offerSdp,
                        type: "offer"
                    });
                    const answer = await peerConnection.createAnswer();
                    peerConnection.setLocalDescription(answer);
                    const localDescription = await rtcConnection.getLocalDescription();
                    const encryptedAnswer = utils_1.XorCipher.encrypt(utils_1.Convert.stringToBuffer(localDescription.sdp, true), sharedKey);
                    const responseHeader = "rtc_answer_" + connectionAddress.slice(0, 8) + "-" + this.network.wallet.public.address.slice(0, 8);
                    this.send(responseHeader, encryptedAnswer);
                }
            }
            else if (data.header === "echo") {
                console.log("echo", this.address.slice(0, 8), utils_1.Convert.bufferToString(data.body));
            }
        }
        createMessage(header, body) {
            const headerBuf = new Uint8Array(header.length);
            for (let i = 0; i < header.length; i++) {
                headerBuf[i] = header.charCodeAt(i) & 0xFF;
            }
            const fullUnsigned = utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(Date.now()), [header.length & 0xFF], headerBuf, body);
            return this.network.wallet.signMessage(fullUnsigned);
        }
        destructureMessage(signedMessage) {
            const data = Wallet_1.default.verifyMessage(signedMessage, this.address);
            const message = data.originalMessage;
            const timestamp = utils_1.Convert.bufferToInt(message.subarray(0, 8));
            const headerLength = message[8];
            const headerBuf = message.subarray(9, headerLength + 9);
            const header = String.fromCharCode.apply(null, headerBuf);
            const body = message.slice(message[8] + 9);
            return {
                verified: data.verified && timestamp > Date.now() - 10000,
                header, body
            };
        }
        async signalForWebRTCConnection(connectionAddress, uniqueId) {
            if (!inBrowser) {
                return null;
            }
            return new Promise(resolve => {
                if (!this.neighbors.has(connectionAddress)) {
                    return resolve(null);
                }
                const peerConnection = new RTCPeerConnection({
                    iceServers: [{ urls: "stun:stun2.l.google.com:19302" }]
                });
                const rtcConnection = new WebRTCConnection(peerConnection, connectionAddress, uniqueId, this.network);
                this.network.insertConnection(connectionAddress, rtcConnection);
                const otherKey = new Key_1.default.Public(connectionAddress);
                const sharedKey = this.network.wallet.private.derive(otherKey);
                peerConnection.onnegotiationneeded = async () => {
                    const offer = await peerConnection.createOffer();
                    peerConnection.setLocalDescription(offer);
                    const localDescription = await rtcConnection.getLocalDescription();
                    const encryptedOffer = utils_1.XorCipher.encrypt(utils_1.Convert.stringToBuffer(localDescription.sdp, true), sharedKey);
                    const toAndOffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(connectionAddress, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(uniqueId), encryptedOffer);
                    const response = await this.sendAndWaitForResponse("rtc_offer_forward", toAndOffer, "rtc_answer_" + connectionAddress.slice(0, 8));
                    if (response) {
                        const answerSdp = utils_1.Convert.bufferToString(utils_1.XorCipher.decrypt(response.body, sharedKey), true);
                        peerConnection.setRemoteDescription({
                            sdp: answerSdp,
                            type: "answer"
                        });
                        resolve(rtcConnection);
                    }
                    else {
                        resolve(null);
                    }
                };
            });
        }
    }
    class WebSocketConnection extends Connection {
        constructor(webSocket, connectionAddress, uniqueId, parent, host) {
            super(connectionAddress, uniqueId, parent);
            this.connectionTimestamp = Date.now();
            console.log("Created WebSocket connection with", connectionAddress.slice(0, 8));
            this.serverHost = host;
            webSocket.binaryType = "arraybuffer";
            this.webSocket = webSocket;
            webSocket.addEventListener("error", err => {
                if (err.message) {
                    console.error(err.message);
                }
            });
            if (webSocket.readyState === WebSocket.OPEN) {
                this.internalOpenHandler();
            }
            else {
                webSocket.addEventListener("open", () => {
                    this.internalOpenHandler();
                });
            }
            webSocket.addEventListener("close", () => {
                console.log("WebSocket closed", this.address.slice(0, 8));
                this.internalClosedHandler();
            });
            webSocket.addEventListener("message", event => {
                const data = event.data;
                if (data instanceof ArrayBuffer) {
                    const buf = new Uint8Array(data);
                    this.internalMessageHandler(buf);
                }
                else {
                    console.log("Recieved message of unexpected type", connectionAddress.slice(0, 8), data);
                }
            });
        }
        internalSend(message) {
            this.webSocket.send(message);
        }
        close() {
            if (this.webSocket.readyState === WebSocket.OPEN) {
                this.webSocket.close();
            }
            else {
                this.webSocket.onopen = ev => ev.target.close();
            }
        }
    }
    class WebRTCConnection extends Connection {
        constructor(peerConnection, connectionAddress, uniqueId, parentNetwork) {
            super(connectionAddress, uniqueId, parentNetwork);
            this.incomingMessages = {};
            this.setUpChannel(peerConnection.createDataChannel("channel"));
            peerConnection.ondatachannel = (event) => {
                this.setUpChannel(event.channel);
            };
            let resolveLocalDescription;
            this.localDescriptionPromise = new Promise(resolve => resolveLocalDescription = resolve);
            peerConnection.onicegatheringstatechange = () => {
                if (peerConnection.iceGatheringState === "complete" && peerConnection.localDescription) {
                    resolveLocalDescription(peerConnection.localDescription);
                }
            };
            peerConnection.oniceconnectionstatechange = () => {
                if (peerConnection.iceConnectionState === "failed") {
                    super.internalClosedHandler();
                }
            };
            this.peerConnection = peerConnection;
        }
        getLocalDescription() {
            return this.localDescriptionPromise;
        }
        setUpChannel(channel) {
            this.dataChannel = channel;
            channel.binaryType = "arraybuffer";
            channel.onopen = () => {
                super.internalOpenHandler();
            };
            channel.onerror = (event) => {
                console.error(event.error);
                super.internalClosedHandler();
            };
            channel.onmessage = (event) => {
                const data = event.data;
                if (data instanceof ArrayBuffer) {
                    this.recieveMessageSlice(new Uint8Array(data));
                }
                else {
                    console.log("Recieved message of unexpected type", this.address.slice(0, 8), data);
                }
            };
        }
        recieveMessageSlice(data) {
            if (data.length < 12 || data.length > 60012) {
                return;
            }
            const head = new Uint32Array(data.slice(0, 12).buffer);
            const id = head[0];
            const index = head[1];
            const count = head[2] + 1;
            const slice = data.slice(12);
            if (count === 1) {
                super.internalMessageHandler(slice);
            }
            else {
                let incoming = this.incomingMessages[id];
                if (!incoming) {
                    incoming = this.incomingMessages[id] = {
                        message: new Uint8Array(60000 * count),
                        recievedSlices: 0,
                        totalBytes: 0
                    };
                }
                incoming.message.set(slice, index * 60000);
                incoming.totalBytes += slice.length;
                incoming.recievedSlices += 1;
                if (incoming.recievedSlices >= count) {
                    const fullMessage = incoming.message.slice(0, incoming.totalBytes);
                    super.internalMessageHandler(fullMessage);
                    this.incomingMessages[id] = undefined;
                }
            }
        }
        internalSend(message) {
            let messageIndex = 0;
            let sliceIndex = 0;
            const totalSlices = Math.floor(message.length / 60000); // Starts at zero
            const id = Math.floor(Math.random() * 0xFFFFFFFF);
            while (messageIndex < message.length) {
                const head = new Uint32Array([
                    id, sliceIndex, totalSlices
                ]);
                this.dataChannel.send(utils_1.Buffer.concat(new Uint8Array(head.buffer), message.slice(messageIndex, messageIndex += 60000)));
                sliceIndex += 1;
            }
        }
        close() {
            if (this.dataChannel.readyState === "open") {
                this.dataChannel.close();
            }
            else {
                this.dataChannel.onopen = () => {
                    this.dataChannel.close();
                    this.peerConnection.close();
                };
            }
        }
    }
    class Client extends Network {
        constructor(wallet) {
            super(wallet);
            this.totalConnections = 0;
            this.connections = {};
            this.cachedServers = {};
            this.uniqueId = Math.floor(Math.random() * 0xFFFFFFFF);
            if (inBrowser) {
                this.connectToWebSocket(location.host);
            }
        }
        async attemptConnection(connectionAddress) {
            const currentConnection = this.bestConnection(connectionAddress);
            if ((currentConnection === null || currentConnection === void 0 ? void 0 : currentConnection.state) === "open") {
                return currentConnection;
            }
            const cached = this.cachedServers[connectionAddress];
            if (cached) {
                return await this.connectToWebSocket(cached, connectionAddress);
            }
            else if (inBrowser) {
                const connectionAddresses = utils_1.shuffle(Array.from(this.connectedAddresses));
                for (const addr of connectionAddresses) {
                    for (const connection of Array.from(this.connections[addr])) {
                        const neighborIds = connection.neighbors.get(connectionAddress);
                        if (!neighborIds || !neighborIds.length) {
                            continue;
                        }
                        if (connection.state === "open" && neighborIds[0]) {
                            const newConnection = await connection.signalForWebRTCConnection(connectionAddress, neighborIds[0]);
                            if (!newConnection) {
                                return null;
                            }
                            if (newConnection.state === "open") {
                                return newConnection;
                            }
                            return await new Promise(resolve => {
                                newConnection.on("open", () => resolve(newConnection));
                                setTimeout(resolve, 5000, null); // Wait a maximum of 5 seconds for the connection to open
                            });
                        }
                    }
                }
            }
            return null;
        }
        async connectToWebSocket(host, connectionAddress) {
            if (connectionAddress) {
                this.cachedServers[connectionAddress] = host;
                if (this instanceof Server && (host === this.publicHost || connectionAddress === this.wallet.public.address)) {
                    return null;
                }
                const connection = this.bestConnection(connectionAddress);
                if (connection instanceof WebSocketConnection && connection.state === "open") {
                    return connection;
                }
            }
            let httpsSupported = false;
            let info;
            try {
                info = await node_fetch_1.default("https://" + host + "/node-info").then(res => res.json());
                httpsSupported = true;
            }
            catch (err) {
                if (err.message.toLowerCase().includes("ssl")) { // https not supported
                    try {
                        info = await node_fetch_1.default("http://" + host + "/node-info").then(res => res.json());
                    }
                    catch (err) {
                        console.error("Failed connection to " + host + ", not a valid node");
                        return null;
                    }
                }
                else {
                    console.error("Failed connection to " + host + ", not a valid node");
                    return null;
                }
            }
            try {
                host = info.host;
                if (!host ||
                    typeof info.uniqueId !== "number" ||
                    info.network !== CoinTable_1.default.networkId ||
                    (connectionAddress && info.address !== connectionAddress)) {
                    return null;
                }
                this.cachedServers[info.address] = host;
            }
            catch (err) { // Malformed response
                return null;
            }
            const previousConnection = this.getConnection(info.address, info.uniqueId);
            if (previousConnection && previousConnection.state !== "closed") {
                return null;
            }
            let url = httpsSupported ? "wss://" : "ws://";
            if (inBrowser && !httpsSupported && location.protocol === "https:") {
                console.error("Failed connection to " + host + " due to secure context");
                return null;
            }
            let path = host + "/" + this.wallet.public.address + "/" + this.uniqueId + "/" + Date.now();
            if (this instanceof Server && this.publicHost) {
                path += "/" + encodeURIComponent(this.publicHost);
            }
            url += path;
            const signature = utils_1.Convert.Base58.encode(this.wallet.private.sign(path));
            url += "/" + signature;
            const ws = new WebSocket(url);
            let connection;
            try {
                connection = new WebSocketConnection(ws, info.address, info.uniqueId, this, host);
                this.insertConnection(info.address, connection);
            }
            catch (err) {
                console.error(err);
                ws.onerror = err => {
                    if (err.message) {
                        console.error(err.message);
                    }
                };
                ws.onopen = () => ws.close();
                return null;
            }
            return new Promise(resolve => {
                ws.onerror = (err) => {
                    if (err.message) {
                        console.error(err.message);
                    }
                    resolve(null);
                };
                connection.on("open", () => resolve(connection));
            });
        }
        insertConnection(address, connection) {
            const connections = this.connections[address];
            if (connections) {
                if (!connections.has(connection)) {
                    this.totalConnections += 1;
                    connections.add(connection);
                }
            }
            else {
                this.totalConnections += 1;
                this.connections[address] = new Set([connection]);
            }
        }
        deleteConnection(address, connection) {
            const connections = this.connections[address];
            if (connections === null || connections === void 0 ? void 0 : connections.delete(connection)) {
                this.totalConnections -= 1;
            }
        }
        getConnection(address, id) {
            const connections = this.connections[address];
            if (!connections) {
                return null;
            }
            for (const connection of Array.from(connections)) {
                if (connection.uniqueId === id) {
                    return connection;
                }
            }
            return null;
        }
        bestConnection(address) {
            const connections = this.connections[address];
            if (!connections) {
                return null;
            }
            let bestConnection = null;
            for (const connection of Array.from(connections)) {
                if (connection.state !== "open") {
                    continue;
                }
                if (connection instanceof WebSocketConnection) {
                    return connection;
                }
                bestConnection = connection;
            }
            return bestConnection;
        }
        shareWithAll(header, body, excluding) {
            this.connectedAddresses.forEach(connectionAddress => {
                if (connectionAddress === excluding) {
                    return;
                }
                this.connections[connectionAddress].forEach(connection => {
                    if (connection === excluding) {
                        return;
                    }
                    if (!connection || connection.state !== "open") {
                        return;
                    }
                    connection.send(header, body);
                });
            });
        }
        async requestBalance(balanceAddress, connectionAddress, id) {
            const connection = id ? this.getConnection(connectionAddress, id) : this.bestConnection(connectionAddress);
            if (!connection) {
                return null;
            }
            const response = await connection.sendAndWaitForResponse("get_balance", utils_1.Convert.Base58.decodeBuffer(balanceAddress), "response_balance_" + balanceAddress.slice(0, 8));
            if (!response || !response.verified) {
                return null;
            }
            const buffer = response.body;
            let startIndex = 0;
            const amount = utils_1.Convert.bufferToInt(buffer.subarray(0, startIndex += 8));
            const timestamp = utils_1.Convert.bufferToInt(buffer.subarray(startIndex, startIndex += 8));
            const signature = utils_1.Convert.Base58.encode(buffer.subarray(startIndex));
            return {
                amount, timestamp, signature
            };
        }
        async requestTable(connectionAddress, id) {
            const connection = id ? this.getConnection(connectionAddress, id) : this.bestConnection(connectionAddress);
            if (!connection) {
                return null;
            }
            const response = await connection.sendAndWaitForResponse("get_table", new Uint8Array(), "response_table");
            if (!response || !response.verified) {
                return null;
            }
            try {
                const table = CoinTable_1.default.importBuffer(response.body);
                return table;
            }
            catch (err) {
                console.error(err);
            }
            return null;
        }
        async shareTable(table, excluding) {
            this.shareWithAll("new_table", table.digest, excluding);
        }
        async shareTransaction(transaction, excluding) {
            const transactionBuffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(transaction.sender, Key_1.default.Public.LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.senderSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.senderTransactionSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.reciever, Key_1.default.Public.LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.recieverSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.int64ToBuffer(transaction.amount), utils_1.Convert.int64ToBuffer(transaction.timestamp));
            this.shareWithAll("new_transaction", transactionBuffer, excluding);
        }
        async sendPendingTransaction(transaction) {
            var _a;
            let connection = this.bestConnection(transaction.reciever);
            if (!connection || connection.state !== "open") {
                connection = await this.attemptConnection(transaction.reciever);
            }
            if /* still */ (!connection || connection.state !== "open") {
                return null;
            }
            const transactionBuffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(transaction.sender, Key_1.default.Public.LENGTH), utils_1.Convert.Base58.decodeBuffer((_a = transaction.senderSignature) !== null && _a !== void 0 ? _a : "1", Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.senderTransactionSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.reciever, Key_1.default.Public.LENGTH), utils_1.Convert.int64ToBuffer(transaction.amount), utils_1.Convert.int64ToBuffer(transaction.timestamp));
            const response = await connection.sendAndWaitForResponse("pending_transaction", transactionBuffer, "pending_transaction_signature", true);
            if (response && response.verified && response.body.byteLength > 0) {
                const signature = utils_1.Convert.Base58.encode(utils_1.XorCipher.decrypt(response.body, connection.sharedEncryptionKey));
                const signedTransaction = utils_1.deepClone(transaction);
                if (!transaction.senderSignature) {
                    signedTransaction.senderSignature = signature;
                }
                else {
                    signedTransaction.recieverSignature = signature;
                }
                return signedTransaction;
            }
            return false;
        }
        internalDispose() {
            Object.keys(this.connections).forEach(addr => {
                this.connections[addr].forEach(connection => connection.close());
            });
        }
    }
    Network.Client = Client;
    class Server extends Client {
        constructor(wallet, publicHost, port, staticPath) {
            super(wallet);
            this.connections = {};
            this.publicHost = publicHost;
            this.wsServer = new WebSocket.Server({ noServer: true });
            this.server = http.createServer(this.requestListener.bind(this));
            this.server.listen(port);
            this.initWebSocketServer();
            if (staticPath) {
                this.staticServe = serveStatic(staticPath);
            }
        }
        initWebSocketServer() {
            const wss = this.wsServer;
            this.server.on("upgrade", (request, socket, head) => {
                const splitPath = request.url.slice(1).split("/");
                if (splitPath.length !== 4 && splitPath.length !== 5) {
                    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    socket.destroy();
                    return;
                }
                const address = splitPath[0];
                const uniqueId = parseInt(splitPath[1]);
                const timestamp = parseInt(splitPath[2]);
                const signature = splitPath[splitPath.length - 1];
                if (isNaN(uniqueId) || isNaN(timestamp)) {
                    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    socket.destroy();
                    return;
                }
                if (timestamp < Date.now() - 10000) {
                    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
                    socket.destroy();
                }
                let pubKey;
                try {
                    pubKey = new Key_1.default.Public(address);
                }
                catch (err) {
                    console.error("WebSocket connection error:", err);
                    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    socket.destroy();
                    return;
                }
                const existingConnection = this.getConnection(address, uniqueId);
                if (existingConnection) {
                    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
                    socket.destroy();
                    return;
                }
                try {
                    const pathMinusSignature = splitPath.slice();
                    pathMinusSignature.pop();
                    const path = this.publicHost + "/" + pathMinusSignature.join("/");
                    const verified = pubKey.verify(path, signature);
                    if (!verified) {
                        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
                        socket.destroy();
                        return;
                    }
                }
                catch (err) {
                    console.error("WebSocket verification error:", err);
                    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    socket.destroy();
                    return;
                }
                wss.handleUpgrade(request, socket, head, ws => {
                    wss.emit("connection", ws, request);
                });
            });
            wss.on("connection", (ws, request) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const splitPath = request.url.slice(1).split("/");
                const connectionAddress = splitPath[0];
                const uniqueId = parseInt(splitPath[1]);
                let connectionHost;
                if (splitPath.length === 5) {
                    connectionHost = decodeURIComponent(splitPath[3]);
                }
                try {
                    const connection = new WebSocketConnection(ws, connectionAddress, uniqueId, this, connectionHost);
                    this.insertConnection(connectionAddress, connection);
                    console.log("New connection to server", connectionAddress.slice(0, 8), connectionHost);
                }
                catch (err) {
                    console.error(err);
                }
            });
        }
        requestListener(req, res) {
            console.log(req.method, req.url);
            if (req.headers.origin) {
                res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
                res.setHeader("Access-Control-Request-Method", "*");
                res.setHeader("Access-Control-Allow-Methods", "OPTIONS, GET");
                res.setHeader("Access-Control-Allow-Headers", "*");
                if (req.method === "OPTIONS") {
                    res.writeHead(200);
                    res.end();
                    return;
                }
            }
            if (req.method === "GET" && req.url === "/node-info") {
                const info = {
                    address: this.node.wallet.public.address,
                    network: CoinTable_1.default.networkId,
                    host: this.publicHost,
                    uniqueId: this.uniqueId
                };
                res.writeHead(200);
                res.end(JSON.stringify(info));
                return;
            }
            if (this.staticServe) {
                this.staticServe(req, res, () => {
                    res.writeHead(404);
                    res.end("404 Not Found");
                });
            }
            else {
                res.writeHead(404);
                res.end("404 Not Found");
            }
        }
    }
    Network.Server = Server;
})(Network || (Network = {}));
exports.default = Network;
//# sourceMappingURL=Network.js.map
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
            if (!connection) {
                return null;
            }
            return (_a = connection.table.balances[balanceAddress]) !== null && _a !== void 0 ? _a : false;
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
            Array.from(this.connectedAddresses).forEach(connId => {
                if (connId === excluding) {
                    return;
                }
                const recieverNode = this.connections[connId];
                recieverNode.processTransaction(transaction);
            });
        }
        async confirmTransaction(transaction) {
            await new Promise(r => setTimeout(r, 250));
            let totalVotes = 0;
            let affirmitiveVotes = 0;
            const confirmationResultResponses = [];
            await Promise.all(Array.from(this.connectedAddresses).map(connId => {
                if (connId === transaction.reciever || connId === transaction.sender) {
                    return;
                }
                const votingPower = this.node.votingPower(connId);
                if (!votingPower) {
                    return;
                }
                const connection = this.connections[connId];
                return new Promise(resolve => {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    connection.verifyTransactionPendingConfirmation(transaction, (vote) => {
                        totalVotes += votingPower;
                        if (vote) {
                            affirmitiveVotes += votingPower;
                            return new Promise(resolve => {
                                confirmationResultResponses.push(resolve);
                            });
                        }
                        resolve();
                    });
                    setTimeout(resolve, 100);
                });
            }));
            return affirmitiveVotes >= 0.75 * totalVotes;
        }
        async sendPendingTransaction(transaction) {
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
            const recieverNode = this.connections[sendTo];
            await new Promise(r => setTimeout(r, 250));
            return recieverNode.signPendingTransaction(transaction, this.wallet.public.address);
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
            this.network.networkAddresses.insert(address);
        }
        deleteNeighbor(address, uniqueId) {
            const currentIds = this.neighbors.get(address);
            if (currentIds) {
                const idIndex = currentIds.indexOf(uniqueId);
                if (idIndex >= 0) {
                    currentIds.splice(idIndex, 1);
                }
            }
            this.network.removeAddressFromNetwork(address);
        }
        internalOpenHandler() {
            if (this.state !== "connecting") {
                return;
            } // Only run if state is currently in "connecting"
            // const connections = this.network["connections"]
            const connectionBuffers = [];
            this.network.allConnections.forEach(connection => {
                if (connection === this || connection.state !== "open") {
                    return;
                }
                connectionBuffers.push(utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(connection.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(connection.uniqueId)));
            });
            this.send("connections", utils_1.Buffer.concat(...connectionBuffers));
            const connectionInfoBuffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(this.uniqueId));
            let serverData = null;
            let host;
            if (this instanceof WebSocketConnection && this.serverHost) {
                host = this.serverHost;
                serverData = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(this.uniqueId), utils_1.Convert.stringToBuffer(host));
            }
            this.network.allConnections.forEach(connection => {
                if (connection.address === this.address) {
                    return;
                }
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
            let connectionCount = connectionBuffers.length;
            if (connectionCount > 10) { // Balance the responsibility of syncing the table with new peers
                if (!serverData && connectionCount > 100) { // Clients will limit their connections
                    connectionCount = 100;
                }
                const balancingProbability = 10 / connectionCount;
                if (Math.random() < balancingProbability) {
                    this.send("new_table", this.network.node.table.digest);
                }
            }
            else {
                this.send("new_table", this.network.node.table.digest);
            }
            this.network.connectedAddresses.add(this.address);
            this.network.networkAddresses.insert(this.address);
            this.state = "open";
            this.dispatchEvent("open");
            this.network.dispatchEvent("connection", { address: this.address, host });
        }
        internalClosedHandler() {
            this.network.deleteConnection(this.address, this);
            this.network.removeAddressFromNetwork(this.address);
            if (this.state !== "open") {
                this.state = "closed";
                return;
            } // Only run if connection is open
            this.state = "closed";
            this.dispatchEvent("close");
            this.network.dispatchEvent("disconnection", { address: this.address });
            this.network.shareWithAll("connection_closed", utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH), utils_1.Convert.int32ToBuffer(this.uniqueId)));
        }
        send(header, body, encrypted) {
            console.log("Sending message", this.address.slice(0, 8), header, encrypted ? "encrypted" : "not encrypted");
            if (encrypted) {
                body = utils_1.XorCipher.encrypt(body, this.sharedEncryptionKey);
            }
            this.internalSend(this.createMessage(header, body));
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
            if (!data.verified) {
                return;
            }
            console.log("Recieved message", this.address.slice(0, 8), data.header);
            if (data.header === "get_balance") {
                const address = utils_1.Convert.Base58.encode(data.body);
                const balance = this.network.node.table.balances[address];
                const responseHeader = "response_balance_" + address.slice(0, 8);
                if (balance) {
                    this.send(responseHeader, utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(balance.amount), utils_1.Convert.int64ToBuffer(balance.timestamp), utils_1.Convert.Base58.decodeBuffer(balance.signature)));
                }
                else {
                    this.send(responseHeader, new Uint8Array());
                }
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
            else if (data.header === "confirm_transaction") {
                let startIndex = 0;
                const sender = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const senderTransactionSignature = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.SIG_LENGTH));
                const reciever = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const amount = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 8));
                const timestamp = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 8));
                const transaction = { sender, senderTransactionSignature, reciever, amount, timestamp };
                this.network.node.confirmPendingTransaction(transaction, async (vote) => {
                    const voteBuffer = new Uint8Array([+vote]);
                    const response = await this.sendAndWaitForResponse("confirmation_response", voteBuffer, "transaction_confirmed");
                    if (!response || !response.verified) {
                        return false;
                    }
                    return !!response.body[0];
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
                this.network.node.processTransaction(transaction);
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
                const response = await this.network.node.signPendingTransaction(pendingTransaction, this.address);
                if (response) {
                    const recieverSignature = utils_1.Convert.Base58.decodeBuffer(response.recieverSignature);
                    this.send("pending_transaction_signature", recieverSignature, true);
                }
                else {
                    this.send("pending_transaction_signature", new Uint8Array());
                }
            }
            else if (data.header === "server_connected") {
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(0, Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(Key_1.default.Public.LENGTH, Key_1.default.Public.LENGTH + 4));
                this.insertNeighbor(connectionAddress, uniqueId);
                const currentConnection = this.network.getConnection(connectionAddress, uniqueId);
                const alreadyConnected = currentConnection && currentConnection.state !== "closed";
                if (!alreadyConnected) {
                    const host = utils_1.Convert.bufferToString(data.body.subarray(Key_1.default.Public.LENGTH + 4));
                    this.network.connectToWebSocket(host, connectionAddress);
                }
            }
            else if (data.header === "connections") {
                let startIndex = 0;
                while (startIndex < data.body.byteLength) {
                    const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                    const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 4));
                    this.insertNeighbor(connectionAddress, uniqueId);
                }
            }
            else if (data.header === "new_connection" && inBrowser) {
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(0, Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(Key_1.default.Public.LENGTH));
                this.insertNeighbor(connectionAddress, uniqueId);
                const connection = this.network.getConnection(connectionAddress, uniqueId);
                if (!connection || connection.state === "closed") {
                    const totalConnections = this.network.allConnections.size;
                    const ignoreProbability = totalConnections / 100;
                    if (Math.random() > ignoreProbability) {
                        this.signalForWebRTCConnection(connectionAddress, uniqueId);
                    }
                }
            }
            else if (data.header === "connection_closed") {
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(0, Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(Key_1.default.Public.LENGTH));
                this.deleteNeighbor(connectionAddress, uniqueId);
            }
            else if (data.header === "rtc_offer_forward") {
                let startIndex = 0;
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 4));
                const connection = this.network.getConnection(connectionAddress, uniqueId);
                if (connection && connection.state === "open") {
                    const responseHeader = "rtc_answer_" + this.address.slice(0, 8) + "-" + connectionAddress.slice(0, 8);
                    const message = data.body;
                    message.set(utils_1.Convert.Base58.decodeBuffer(this.address, Key_1.default.Public.LENGTH));
                    message.set(utils_1.Convert.int32ToBuffer(this.uniqueId), Key_1.default.Public.LENGTH);
                    const response = await (connection === null || connection === void 0 ? void 0 : connection.sendAndWaitForResponse("rtc_offer", message, responseHeader));
                    if (response) {
                        this.send("rtc_answer_" + connectionAddress.slice(0, 8), response.body);
                    }
                }
                else {
                    this.send("rtc_answer_" + connectionAddress.slice(0, 8), new Uint8Array([]));
                }
            }
            else if (data.header === "rtc_offer" && inBrowser) {
                let startIndex = 0;
                const connectionAddress = utils_1.Convert.Base58.encode(data.body.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH));
                const uniqueId = utils_1.Convert.bufferToInt(data.body.subarray(startIndex, startIndex += 4));
                const connection = this.network.getConnection(connectionAddress, uniqueId);
                console.log("RTC Offer", connectionAddress.slice(0, 8), uniqueId);
                if (!connection || connection.state === "closed") {
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
                    if ((response === null || response === void 0 ? void 0 : response.verified) && response.body.length) {
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
                this.internalClosedHandler();
            });
            webSocket.addEventListener("message", event => {
                const data = event.data;
                if (data instanceof ArrayBuffer) {
                    const buf = new Uint8Array(data);
                    this.internalMessageHandler(buf);
                }
                else {
                    console.error("Recieved message of unexpected type", connectionAddress.slice(0, 8), data);
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
            channel.onerror = event => {
                console.error(event.error);
                super.internalClosedHandler();
            };
            channel.onclose = () => {
                super.internalClosedHandler();
            };
            channel.onmessage = (event) => {
                const data = event.data;
                if (data instanceof ArrayBuffer) {
                    this.recieveMessageSlice(new Uint8Array(data));
                }
                else {
                    console.error("Recieved message of unexpected type", this.address.slice(0, 8), data);
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
            this.networkAddresses = new utils_1.SortedList(true);
            this.allConnections = new Set();
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
                if (this instanceof Server && host === this.publicHost) {
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
                    connections.add(connection);
                }
            }
            else {
                this.connections[address] = new Set([connection]);
            }
            this.allConnections.add(connection);
        }
        deleteConnection(address, connection) {
            var _a;
            (_a = this.connections[address]) === null || _a === void 0 ? void 0 : _a.delete(connection);
            this.allConnections.delete(connection);
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
        removeAddressFromNetwork(address) {
            let stillOnNetwork = false;
            for (const connection of this.allConnections) {
                if (connection.neighbors.has(address)) {
                    stillOnNetwork = true;
                    break;
                }
            }
            if (!stillOnNetwork) {
                const index = this.networkAddresses.indexOf(address);
                if (index >= 0) {
                    this.networkAddresses.list.splice(index, 1);
                }
            }
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
            if (!(response === null || response === void 0 ? void 0 : response.verified)) {
                return null;
            }
            if (!response.body.length) {
                return false;
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
        async shareTransaction(transaction, exclude) {
            const transactionBuffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(transaction.sender, Key_1.default.Public.LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.senderSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.senderTransactionSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.reciever, Key_1.default.Public.LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.recieverSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.int64ToBuffer(transaction.amount), utils_1.Convert.int64ToBuffer(transaction.timestamp));
            this.shareWithAll("new_transaction", transactionBuffer, exclude);
        }
        async confirmTransaction(transaction) {
            const transactionBuffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(transaction.sender, Key_1.default.Public.LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.senderTransactionSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.reciever, Key_1.default.Public.LENGTH), utils_1.Convert.int64ToBuffer(transaction.amount), utils_1.Convert.int64ToBuffer(transaction.timestamp));
            const senderBalance = this.node.table.balances[transaction.sender];
            if (!senderBalance) {
                return false;
            }
            let seed = 0;
            const amountArr = new Uint32Array(utils_1.Convert.int64ToBuffer(senderBalance.amount).buffer);
            for (let i = 0; i < 2; i++) {
                seed ^= amountArr[i];
            }
            const timestampArr = new Uint32Array(utils_1.Convert.int64ToBuffer(senderBalance.timestamp).buffer);
            for (let i = 0; i < 2; i++) {
                seed ^= timestampArr[i];
            }
            const senderArr = new Uint32Array(utils_1.Convert.Base58.decodeBuffer(transaction.sender, 36).buffer);
            for (let i = 0; i < 9; i++) {
                seed ^= senderArr[i];
            }
            console.log("seed", seed);
            const rand = utils_1.Random.mulberry32(seed);
            const potentialQuorumMembers = this.networkAddresses.list.filter(address => {
                var _a;
                if (address === transaction.sender || address === transaction.reciever) {
                    return false;
                }
                if (!((_a = this.node.table.balances[address]) === null || _a === void 0 ? void 0 : _a.amount)) {
                    return false;
                }
                return true;
            });
            console.log("Potential confirmation connections", potentialQuorumMembers);
            const potentialAddressesCount = potentialQuorumMembers.length;
            const requiredVotes = 100;
            let totalVotes = 0;
            let affirmativeVotes = 0;
            const voterConnections = [];
            const networkAddresses = utils_1.SortedList.fromAlreadySorted(potentialQuorumMembers);
            for (let i = 0; i < potentialAddressesCount;) {
                const remainingVotes = requiredVotes - totalVotes;
                let pendingVotes = 0;
                const pendingVoteResponses = [];
                while (pendingVotes < remainingVotes && i < potentialAddressesCount) {
                    i += 1;
                    const genAddressArr = [1];
                    for (let i = 0; i < 33; i++) {
                        genAddressArr.push(Math.floor(rand() * 256));
                    }
                    const genAddress = utils_1.Convert.Base58.encode(genAddressArr);
                    const addrIndex = networkAddresses.indexOfNearby(genAddress);
                    const address = networkAddresses.list.splice(addrIndex, 1)[0];
                    pendingVoteResponses.push((async () => {
                        const connection = await this.attemptConnection(address);
                        if ((connection === null || connection === void 0 ? void 0 : connection.state) !== "open") {
                            return;
                        }
                        const response = await connection.sendAndWaitForResponse("confirm_transaction", transactionBuffer, "confirmation_response");
                        if (!(response === null || response === void 0 ? void 0 : response.verified)) {
                            return;
                        }
                        voterConnections.push(connection);
                        totalVotes += 1;
                        if (response.body[0]) {
                            affirmativeVotes += 1;
                        }
                    })());
                    pendingVotes += 1;
                }
                await Promise.all(pendingVoteResponses);
            }
            console.log(voterConnections.map(conn => conn.address.slice(0, 10) + "/" + conn.uniqueId));
            console.log({ totalVotes, affirmativeVotes });
            const confirmed = affirmativeVotes >= totalVotes * 0.75;
            const confirmedBuffer = new Uint8Array([+confirmed]);
            voterConnections.forEach(connection => {
                connection.send("transaction_confirmed", confirmedBuffer);
            });
            return confirmed;
        }
        async sendPendingTransaction(transaction) {
            var _a;
            const connection = await this.attemptConnection(transaction.reciever);
            if ((connection === null || connection === void 0 ? void 0 : connection.state) !== "open") {
                return null;
            }
            const transactionBuffer = utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(transaction.sender, Key_1.default.Public.LENGTH), utils_1.Convert.Base58.decodeBuffer((_a = transaction.senderSignature) !== null && _a !== void 0 ? _a : "1", Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.senderTransactionSignature, Key_1.default.SIG_LENGTH), utils_1.Convert.Base58.decodeBuffer(transaction.reciever, Key_1.default.Public.LENGTH), utils_1.Convert.int64ToBuffer(transaction.amount), utils_1.Convert.int64ToBuffer(transaction.timestamp));
            const response = await connection.sendAndWaitForResponse("pending_transaction", transactionBuffer, "pending_transaction_signature", true, 20000);
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
import type Node from "./Node";
import { EventTarget } from "./utils";
import CoinTable from "./CoinTable";
import Wallet from "./Wallet";
import type * as WS from "ws";
declare type NetworkEvents = {
    "tabledigest": {
        digest: Uint8Array;
        from: {
            address: string;
            id?: number;
        };
    };
    "transaction": {
        transaction: CoinTable.SignedTransaction;
        from: string;
    };
    "connection": {
        address: string;
        host?: string;
    };
    "disconnection": {
        address: string;
    };
};
declare abstract class Network extends EventTarget<NetworkEvents> {
    readonly wallet: Wallet;
    node: Node;
    connectedAddresses: Set<string>;
    constructor(wallet: Wallet);
    abstract requestBalance(balanceAddress: string, connectionAddress: string, id?: number): Promise<CoinTable.SignedBalance | null>;
    abstract requestTable(connectionAddress: string, id?: number): Promise<CoinTable | null>;
    abstract shareTable(table: CoinTable, exclude?: string): Promise<void>;
    abstract shareTransaction(transaction: CoinTable.SignedTransaction, exclude?: string): Promise<void>;
    abstract sendPendingTransaction(transaction: CoinTable.PendingTransaction): Promise<CoinTable.SignedTransaction | false | null>;
    onRecievingPendingTransaction: (transaction: CoinTable.PendingTransaction, from: string) => Promise<CoinTable.SignedTransaction | false> | CoinTable.SignedTransaction | false;
}
declare namespace Network {
    export class Local extends Network {
        private connections;
        connect(node: Node): void;
        requestBalance(balanceAddress: string, connectionAddress: string): Promise<CoinTable.SignedBalance | null>;
        requestTable(connectionAddress: string): Promise<CoinTable | null>;
        shareTable(table: CoinTable, excluding: string): Promise<void>;
        shareTransaction(transaction: CoinTable.SignedTransaction, excluding: string): Promise<void>;
        sendPendingTransaction(transaction: CoinTable.PendingTransaction): Promise<CoinTable.SignedTransaction | false | null>;
    }
    interface Message {
        verified: boolean;
        header: string;
        body: Uint8Array;
    }
    type ConnectionEvents = {
        "message": Message;
        "open": undefined;
        "close": undefined;
    };
    abstract class Connection extends EventTarget<ConnectionEvents> {
        readonly address: string;
        readonly uniqueId: number;
        readonly sharedEncryptionKey: Uint8Array;
        readonly network: Client;
        state: "connecting" | "open" | "closed";
        readonly neighbors: Map<string, number[]>;
        constructor(connectionAddress: string, uniqueId: number, parentNetwork: Client);
        private insertNeighbor;
        private deleteNeighbor;
        protected internalOpenHandler(): void;
        protected internalClosedHandler(): void;
        protected abstract internalSend(message: Uint8Array): void;
        send(header: string, body: Uint8Array, encrypted?: boolean): void;
        private pendingResponses;
        sendAndWaitForResponse(header: string, body: Uint8Array, responseHeader: string, encrypt?: boolean, timeout?: number): Promise<Message | null>;
        protected internalMessageHandler(message: Uint8Array): Promise<void>;
        private handleMessage;
        private createMessage;
        private destructureMessage;
        signalForWebRTCConnection(connectionAddress: string, uniqueId: number): Promise<WebRTCConnection | null>;
    }
    class WebSocketConnection extends Connection {
        readonly serverHost?: string;
        readonly webSocket: WS;
        readonly network: Network.Client;
        readonly connectionTimestamp: number;
        constructor(webSocket: WS, connectionAddress: string, uniqueId: number, parent: Network.Client, host?: string);
        internalSend(message: Uint8Array): void;
    }
    class WebRTCConnection extends Connection {
        readonly network: Network.Client;
        private localDescriptionPromise;
        private dataChannel;
        constructor(peerConnection: RTCPeerConnection, connectionAddress: string, uniqueId: number, parentNetwork: Network.Client);
        getLocalDescription(): Promise<RTCSessionDescription>;
        private setUpChannel;
        private incomingMessages;
        private recieveMessageSlice;
        protected internalSend(message: Uint8Array): void;
    }
    export class Client extends Network {
        totalConnections: number;
        protected connections: {
            [walletAddress: string]: Set<Connection>;
        };
        protected cachedServers: {
            [walletAddress: string]: string;
        };
        uniqueId: number;
        constructor(wallet: Wallet);
        attemptConnection(connectionAddress: string): Promise<Connection | null>;
        connectToWebSocket(host: string, connectionAddress?: string): Promise<WebSocketConnection | null>;
        insertConnection(address: string, connection: Connection): void;
        deleteConnection(address: string, connection: Connection): void;
        getConnection(address: string, id: number): Connection | null;
        bestConnection(address: string): Connection | null;
        shareWithAll(header: string, body: Uint8Array, excluding?: string | Connection): void;
        requestBalance(balanceAddress: string, connectionAddress: string, id?: number): Promise<CoinTable.SignedBalance | null>;
        requestTable(connectionAddress: string, id?: number): Promise<CoinTable | null>;
        shareTable(table: CoinTable, excluding?: string | Connection): Promise<void>;
        shareTransaction(transaction: CoinTable.SignedTransaction, excluding?: string): Promise<void>;
        sendPendingTransaction(transaction: CoinTable.PendingTransaction): Promise<false | CoinTable.SignedTransaction | null>;
    }
    export class Server extends Client {
        readonly connections: {
            [walletAddress: string]: Set<WebSocketConnection>;
        };
        readonly publicHost: string;
        private readonly wsServer;
        private readonly server;
        private readonly staticServe?;
        constructor(wallet: Wallet, publicHost: string, port: number, staticPath?: string);
        private initWebSocketServer;
        private requestListener;
    }
    export {};
}
export default Network;

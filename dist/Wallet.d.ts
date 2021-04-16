import type CoinTable from "./CoinTable";
import type Node from "./Node";
import Key from "./Key";
declare class Wallet {
    readonly public: Key.Public;
    readonly private: Key.Private;
    node: Node;
    constructor(privateKey: string | Key.Private, publicAddress?: string | Key.Public);
    signBalance(balance: CoinTable.Balance): CoinTable.SignedBalance;
    static verifyBalance(balance: CoinTable.SignedBalance, publicKey: Key.Public | string): boolean;
    createTransaction(amount: number, reciever: Key.Public | string): CoinTable.PendingTransaction;
    signTransaction(transaction: CoinTable.PendingTransaction): CoinTable.SignedTransaction;
    verifyTransaction(transaction: CoinTable.SignedTransaction): boolean;
    signMessage(buf: Uint8Array): Uint8Array;
    static verifyMessage(buf: Uint8Array, from: Key.Public | string): {
        verified: boolean;
        originalMessage: Uint8Array;
    };
    static generate(): Wallet;
    isValid(): boolean;
    static importJSON(json: Wallet.JSONObject | string, password?: string): Wallet;
    static importJSON(json: Wallet.JSONObject | string, password: string, progressObj: {
        progress?: number;
        stop?: boolean;
    }): Promise<Wallet | null>;
    exportJSON(password?: string, iterations?: number): Wallet.JSONObject;
    exportJSON(password: string, iterations: number | undefined | null, progressObj: {
        progress?: number;
    }): Promise<Wallet.JSONObject | null>;
}
declare namespace Wallet {
    type JSONObject = {
        publicAddress?: string;
        privateKey: string;
        salt?: string;
        iterations?: number;
    };
}
export default Wallet;

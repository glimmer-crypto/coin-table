import Wallet from "./Wallet";
import CoinTable from "./CoinTable";
import Network from "./Network";
import { EventTarget } from "./utils";
declare type NodeEvents = {
    "transactioncompleted": CoinTable.SignedTransaction;
    "newtable": CoinTable;
};
interface NetworkDelegate {
    signPendingTransaction(transaction: CoinTable.PendingTransaction, from: string): Promise<false | CoinTable.SignedTransaction>;
    processTransaction(transaction: CoinTable.SignedTransaction): Promise<void>;
    confirmPendingTransaction(transaction: Omit<CoinTable.PendingTransaction, "senderSignature">, castVote: ((vote: true) => Promise<boolean>) & ((vote: false) => void)): void;
}
export default class Node extends EventTarget<NodeEvents> implements NetworkDelegate {
    readonly wallet: Wallet;
    readonly network: Network;
    table: CoinTable;
    constructor(wallet: Wallet, network: Network, initalTable?: CoinTable);
    private initNetwork;
    signPendingTransaction(transaction: CoinTable.PendingTransaction, from: string): Promise<false | CoinTable.SignedTransaction>;
    pendingTransactions: Set<string>;
    confirmPendingTransaction(transaction: CoinTable.ConfirmationTransaction, castVote: (vote: boolean) => Promise<boolean>): Promise<void>;
    processTransaction(transaction: CoinTable.SignedTransaction): Promise<void>;
    /**
     * @returns A `CoinTable` if there is a new table and `null` if not
     */
    determineNewTable(oldTable: CoinTable, newTable: CoinTable): Promise<CoinTable | null>;
    private failedTransactions;
    private retryFailedTransactions;
    sendTransaction(amount: number, reciever: string): Promise<boolean | null>;
    getTable(): Promise<CoinTable | null>;
    private queue;
    private addToQueue;
    votingPower(address: string): number;
}
export {};

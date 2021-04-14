import Wallet from "./Wallet";
import CoinTable from "./CoinTable";
import Network from "./Network";
import { EventTarget } from "./utils";
declare type NodeEvents = {
    "transactioncompleted": CoinTable.SignedTransaction;
    "newtable": CoinTable;
};
export default class Node extends EventTarget<NodeEvents> {
    readonly wallet: Wallet;
    readonly network: Network;
    table: CoinTable;
    constructor(wallet: Wallet, network: Network, initalTable?: CoinTable);
    private initNetwork;
    handlePendingTransaction(transaction: CoinTable.PendingTransaction, from: string): Promise<false | CoinTable.SignedTransaction>;
    handleTransaction(transaction: CoinTable.SignedTransaction): Promise<boolean>;
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
}
export {};

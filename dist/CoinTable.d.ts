import { DeepReadonly, SortedList } from "./utils";
declare class CoinTable {
    static readonly identifier: string;
    static readonly networkId: string;
    static readonly TOTAL_COINS: number;
    static readonly SUBDIVISION: number;
    static readonly initialTable: CoinTable;
    readonly balances: DeepReadonly<CoinTable.Balances>;
    readonly isValid: boolean;
    readonly invalidReason?: string;
    readonly digest: Uint8Array;
    readonly addresses: SortedList<string>;
    constructor(balances: CoinTable.Balances);
    verifyTable(): {
        valid: boolean;
        reason?: string;
    };
    applyTransaction(transaction: CoinTable.SignedTransaction): void;
    exportBuffer(): Uint8Array;
    static importBuffer(buffer: Uint8Array): CoinTable;
    static initialize(networkId: string, totalCoins: number, subdivision: number, initialBalances: CoinTable.Balances): void;
}
declare namespace CoinTable {
    interface Balances {
        [walletAddress: string]: SignedBalance;
    }
    interface Balance {
        amount: number;
        timestamp: number;
    }
    interface SignedBalance extends Balance {
        signature: string;
    }
    interface Transaction {
        sender: string;
        reciever: string;
        amount: number;
        timestamp: number;
    }
    interface ConfirmationTransaction extends Transaction {
        senderTransactionSignature: string;
    }
    interface PendingTransaction extends ConfirmationTransaction {
        senderSignature: string;
        recieverSignature?: string;
    }
    interface SignedTransaction extends PendingTransaction {
        recieverSignature: string;
    }
    class TransactionError extends Error {
    }
}
export default CoinTable;

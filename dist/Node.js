"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const CoinTable_1 = require("./CoinTable");
const utils_1 = require("./utils");
class Node extends utils_1.EventTarget {
    constructor(wallet, network, initalTable) {
        super();
        this.failedTransactions = {};
        this.queue = [];
        this.wallet = wallet;
        wallet.node = this;
        this.network = network;
        network.node = this;
        this.table = initalTable !== null && initalTable !== void 0 ? initalTable : CoinTable_1.default.initialTable;
        if (!this.table.isValid) {
            throw new Error("Initial table must be valid");
        }
        this.initNetwork();
    }
    initNetwork() {
        this.network.on("tabledigest", ({ digest, from }) => {
            this.addToQueue(async () => {
                if (!utils_1.Buffer.equal(digest, this.table.digest)) {
                    const table = await this.network.requestTable(from.address, from.id);
                    if (!table) {
                        return;
                    }
                    const newTable = await this.determineNewTable(this.table, table);
                    if (!newTable) {
                        return;
                    }
                    this.table = newTable;
                    this.network.shareTable(newTable);
                    this.dispatchEvent("newtable", newTable);
                }
            });
        });
    }
    // Network delegate methods
    async handlePendingTransaction(transaction, from) {
        var _a;
        const myAddress = this.wallet.public.address;
        const currentBalance = (_a = this.table.balances[myAddress]) !== null && _a !== void 0 ? _a : { timestamp: 0 };
        if (transaction.reciever === myAddress && transaction.sender === from && transaction.timestamp > currentBalance.timestamp) {
            return this.addToQueue(async () => {
                try {
                    const signed = this.wallet.signTransaction(transaction);
                    const confirmed = await this.network.shareTransaction(signed, true, from);
                    if (confirmed) {
                        this.table.applyTransaction(signed);
                        this.dispatchEvent("transactioncompleted", utils_1.deepClone(signed));
                        return signed;
                    }
                }
                catch (err) {
                    console.error(err);
                    return false;
                }
                return false;
            });
        }
        return false;
    }
    async verifyTransaction(transaction) {
        const balances = {
            sender: this.table.balances[transaction.sender],
            reciver: this.table.balances[transaction.reciever]
        };
        if ((balances.sender && transaction.timestamp === balances.sender.timestamp && transaction.senderSignature === balances.sender.signature) &&
            (balances.reciver && transaction.timestamp === balances.reciver.timestamp && transaction.senderSignature === balances.sender.signature)) {
            console.log("Transaction applied previously");
            return true;
        }
        return this.wallet.verifyTransaction(transaction);
    }
    async handleTransaction(transaction) {
        return this.addToQueue(() => {
            try {
                this.table.applyTransaction(transaction);
                this.network.shareTransaction(transaction);
                this.retryFailedTransactions(transaction);
                this.dispatchEvent("transactioncompleted", utils_1.deepClone(transaction));
                console.log("Transaction completed successfully");
            }
            catch (err) {
                if (!err.message.includes("Transaction timestamp is invalid")) {
                    if (!this.failedTransactions[transaction.sender]) {
                        this.failedTransactions[transaction.sender] = [transaction];
                    }
                    else {
                        this.failedTransactions[transaction.sender].push(transaction);
                    }
                    if (!this.failedTransactions[transaction.reciever]) {
                        this.failedTransactions[transaction.reciever] = [transaction];
                    }
                    else {
                        this.failedTransactions[transaction.reciever].push(transaction);
                    }
                }
                console.error(err);
            }
        });
    }
    /**
     * @returns A `CoinTable` if there is a new table and `null` if not
     */
    async determineNewTable(oldTable, newTable) {
        var _a, _b;
        const oldBalances = oldTable.balances;
        const mergedBalances = utils_1.deepClone(oldBalances);
        const allAdresses = new Set(oldTable.walletAddresses);
        const disputedAdresses = new Set();
        if (!newTable.isValid) {
            return null;
        }
        const missingAdresses = new Set(allAdresses);
        newTable.walletAddresses.forEach(walletAddress => {
            const balance = newTable.balances[walletAddress];
            const currentBalance = mergedBalances[walletAddress];
            if (!currentBalance) {
                mergedBalances[walletAddress] = balance;
            }
            else if (currentBalance.timestamp < balance.timestamp) {
                mergedBalances[walletAddress] = balance;
                if (currentBalance.amount !== balance.amount) {
                    disputedAdresses.add(walletAddress);
                }
            }
            if (!allAdresses.has(walletAddress)) {
                allAdresses.add(walletAddress);
                disputedAdresses.add(walletAddress);
            }
            missingAdresses.delete(walletAddress);
        });
        missingAdresses.forEach(missingAddress => {
            disputedAdresses.add(missingAddress);
        });
        const returnTable = new CoinTable_1.default(mergedBalances);
        if (returnTable.isValid) {
            if (utils_1.Buffer.equal(returnTable.digest, oldTable.digest)) {
                return null;
            }
            else {
                return returnTable;
            }
        }
        const myVotes = disputedAdresses.size * Math.sqrt((_b = (_a = oldBalances[this.wallet.public.address]) === null || _a === void 0 ? void 0 : _a.amount) !== null && _b !== void 0 ? _b : 0);
        const votes = {
            old: myVotes,
            new: 0,
            other: 0,
            total: 0
        };
        const connectedAdresses = utils_1.shuffle(Array.from(this.network.connectedAddresses));
        const requiredVoters = Math.max(25, Math.floor(Math.sqrt(connectedAdresses.length)));
        let totalVoters = 0;
        for (let i = 0; i < connectedAdresses.length;) {
            const remainingVoters = requiredVoters - totalVoters;
            let pendingVoters = 0;
            const pendingVotes = [];
            while (pendingVoters < remainingVoters) {
                if (i >= connectedAdresses.length) {
                    break;
                }
                const connectedAddress = connectedAdresses[i];
                i += 1;
                if (connectedAddress === this.wallet.public.address || !allAdresses.has(connectedAddress)) {
                    continue;
                }
                const balance = oldBalances[connectedAddress];
                if (!balance || balance.amount == 0) {
                    continue;
                }
                const votingPower = Math.sqrt(balance.amount);
                pendingVoters += 1;
                pendingVotes.push(((async () => {
                    const requests = new Array(disputedAdresses.size);
                    let addrIndex = 0;
                    disputedAdresses.forEach(disputedAddress => {
                        addrIndex += 1;
                        requests[addrIndex] = (async () => {
                            var _a, _b;
                            const response = await this.network.requestBalance(disputedAddress, connectedAddress);
                            if (!response) {
                                return;
                            }
                            const amount = response.amount;
                            if (amount === ((_a = oldTable.balances[disputedAddress]) === null || _a === void 0 ? void 0 : _a.amount)) {
                                votes.old += votingPower;
                            }
                            else if (amount === ((_b = newTable.balances[disputedAddress]) === null || _b === void 0 ? void 0 : _b.amount)) {
                                votes.new += votingPower;
                            }
                            else {
                                votes.other += votingPower;
                            }
                            votes.total += votingPower;
                            totalVoters += 1;
                        })();
                    });
                    await Promise.all(requests);
                })()));
            }
            await Promise.all(pendingVotes);
        }
        console.log("Votes", this.wallet.public.address.slice(0, 8), votes);
        // 3/4 majority
        if (votes.new >= 0.75 * votes.total) {
            return newTable;
        }
        else {
            return null;
        }
    }
    retryFailedTransactions(transaction) {
        [transaction.sender, transaction.reciever].forEach(addr => {
            const failed = this.failedTransactions[addr];
            if (!failed) {
                return;
            }
            failed.sort((a, b) => a.timestamp - b.timestamp);
            for (let i = 0; i < failed.length; i++) {
                const failedTransaction = failed[i];
                if (failedTransaction.timestamp <= transaction.timestamp) {
                    failed.splice(i, 1);
                    i -= 1;
                }
                else {
                    try {
                        this.table.applyTransaction(failedTransaction);
                        failed.splice(i, 1);
                        i -= 1;
                        this.dispatchEvent("transactioncompleted", utils_1.deepClone(transaction));
                    }
                    catch (err) {
                        break;
                    }
                }
            }
        });
    }
    async sendTransaction(amount, reciever) {
        reciever = utils_1.Convert.Base58.normalize(reciever);
        return this.addToQueue(async () => {
            console.log("sending transaction", amount, reciever);
            const transaction = this.wallet.createTransaction(amount, reciever);
            const signed = await this.network.sendPendingTransaction(transaction);
            if (signed) {
                try {
                    const valid = this.wallet.verifyTransaction(signed);
                    if (!valid) {
                        return false;
                    }
                    const confirmed = await this.network.shareTransaction(signed, true);
                    if (confirmed) {
                        this.table.applyTransaction(signed);
                        this.dispatchEvent("transactioncompleted", utils_1.deepClone(signed));
                        return true;
                    }
                }
                catch (err) {
                    console.error(err);
                }
            }
            else {
                return signed;
            }
            return false;
        });
    }
    getTable() {
        return this.addToQueue(() => this.table);
    }
    addToQueue(action) {
        let actionPromise;
        if (this.queue[0]) {
            actionPromise = this.queue[0].then(() => action(), err => { console.error(err); return err; });
        }
        else {
            actionPromise = (async () => {
                try {
                    return action();
                }
                catch (err) {
                    console.error(err);
                    return err;
                }
            })();
        }
        this.queue.unshift(actionPromise);
        if (this.queue.length > 1) {
            this.queue.pop();
        }
        return actionPromise;
    }
}
exports.default = Node;
//# sourceMappingURL=Node.js.map
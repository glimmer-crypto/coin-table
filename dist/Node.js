"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Wallet_1 = require("./Wallet");
const CoinTable_1 = require("./CoinTable");
const utils_1 = require("./utils");
class Node extends utils_1.EventTarget {
    constructor(wallet, network, initalTable) {
        super();
        this.pendingTransactions = new Set();
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
                    const newTable = await this.determineNewTable(this.table, table, from.address);
                    if (!newTable) {
                        if (newTable === false) {
                            await this.network.shareTable(this.table);
                        }
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
    async signPendingTransaction(transaction, from) {
        var _a;
        const myAddress = this.wallet.public.address;
        const currentBalance = (_a = this.table.balances[myAddress]) !== null && _a !== void 0 ? _a : { timestamp: 0 };
        if (transaction.reciever === myAddress && transaction.sender === from && transaction.timestamp > currentBalance.timestamp) {
            return this.addToQueue(async () => {
                try {
                    const signed = this.wallet.signTransaction(transaction);
                    const confirmed = await this.network.confirmTransaction(signed);
                    console.log("confirmed", !!confirmed);
                    const balanceConfirmed = await this.confirmBalance(transaction.sender);
                    console.log("balance confirmed", balanceConfirmed);
                    if (confirmed && balanceConfirmed) {
                        this.table.applyTransaction(signed);
                        this.dispatchEvent("transactioncompleted", utils_1.deepClone(signed));
                        this.network.shareTransaction(signed);
                        confirmed(true);
                        return signed;
                    }
                    else if (confirmed) {
                        confirmed(false);
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
    async confirmPendingTransaction(transaction, castVote) {
        if (!Wallet_1.default.verifyConfirmationTransaction(transaction)) {
            castVote(false);
            return;
        }
        const pendingTransactions = this.pendingTransactions;
        if (pendingTransactions.has(transaction.sender)) {
            castVote(false);
        }
        else {
            pendingTransactions.add(transaction.sender);
            await castVote(true);
            pendingTransactions.delete(transaction.sender);
        }
    }
    processTransaction(transaction) {
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
                    console.error(err);
                }
            }
        });
    }
    /**
     * @returns A `CoinTable` if there is a new table and `null` if not
     */
    async determineNewTable(oldTable, newTable, from) {
        var _a, _b, _c, _d;
        const oldBalances = oldTable.balances;
        const mergedBalances = utils_1.deepClone(oldBalances);
        const allAdresses = new Set(oldTable.addresses);
        const disputedAdresses = new Set();
        if (!newTable.isValid) {
            return false;
        }
        const missingAdresses = new Set(allAdresses);
        newTable.addresses.list.forEach(walletAddress => {
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
        const senderVotes = disputedAdresses.size * Math.sqrt((_d = (_c = oldBalances[from]) === null || _c === void 0 ? void 0 : _c.amount) !== null && _d !== void 0 ? _d : 0);
        const votes = {
            old: myVotes,
            new: senderVotes,
            other: 0,
            total: 0
        };
        const requiredVoters = 100;
        let totalVoters = 0;
        let pendingVotes = [];
        for (const connectedAddress of utils_1.shuffledLoop(this.network.connectedAddresses)) {
            if (connectedAddress === from || connectedAddress === this.wallet.public.address) {
                continue;
            }
            const votingPower = this.votingPower(connectedAddress);
            if (!votingPower) {
                continue;
            }
            pendingVotes.push((async () => {
                const requests = new Array(disputedAdresses.size);
                let addrIndex = 0;
                disputedAdresses.forEach(disputedAddress => {
                    requests[addrIndex] = (async () => {
                        var _a, _b;
                        const response = await this.network.requestBalance(disputedAddress, connectedAddress, true);
                        if (response === null) {
                            return;
                        }
                        const amount = response ? response.amount : undefined;
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
                    addrIndex += 1;
                });
                await Promise.all(requests);
            })());
            if (pendingVotes.length + totalVoters >= requiredVoters) {
                await Promise.all(pendingVotes);
                pendingVotes = [];
            }
            if (totalVoters >= requiredVoters) {
                break;
            }
        }
        await Promise.all(pendingVotes);
        console.log("Votes", votes);
        // 3/4 majority
        if (votes.new > 0.75 * votes.total) {
            return newTable;
        }
        else {
            return false;
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
    async confirmBalance(address) {
        const requiredVotes = 100;
        let totalVoters = 0;
        let totalVotes = 0;
        let affirmativeVotes = 0;
        const thisBalance = this.table.balances[address];
        let pendingVotes = [];
        for (const connectedAddress of utils_1.shuffledLoop(this.network.connectedAddresses)) {
            if (connectedAddress === address) {
                continue;
            }
            const votingPower = this.votingPower(address);
            if (!votingPower) {
                continue;
            }
            pendingVotes.push((async () => {
                const balance = await this.network.requestBalance(address, connectedAddress);
                if (balance === null) {
                    return;
                }
                totalVoters += 1;
                totalVotes += votingPower;
                if (balance === false) {
                    if (!thisBalance) {
                        affirmativeVotes += votingPower;
                    }
                }
                else if (balance.amount === (thisBalance === null || thisBalance === void 0 ? void 0 : thisBalance.amount) &&
                    balance.timestamp === (thisBalance === null || thisBalance === void 0 ? void 0 : thisBalance.timestamp) &&
                    balance.signature === (thisBalance === null || thisBalance === void 0 ? void 0 : thisBalance.signature)) {
                    affirmativeVotes += votingPower;
                }
            })());
            if (pendingVotes.length + totalVoters >= requiredVotes) {
                await Promise.all(pendingVotes);
                pendingVotes = [];
            }
            if (totalVoters >= requiredVotes) {
                break;
            }
        }
        await Promise.all(pendingVotes);
        if (affirmativeVotes >= totalVotes * 0.75) {
            return true;
        }
        else {
            return false;
        }
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
                    this.table.applyTransaction(signed);
                    this.dispatchEvent("transactioncompleted", utils_1.deepClone(signed));
                    this.network.shareTransaction(signed);
                    return true;
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
    votingPower(address) {
        const balance = this.table.balances[address];
        if (!(balance === null || balance === void 0 ? void 0 : balance.amount)) {
            return 0;
        }
        else {
            return Math.sqrt(balance.amount);
        }
    }
}
exports.default = Node;
//# sourceMappingURL=Node.js.map
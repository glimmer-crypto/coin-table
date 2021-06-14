"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Wallet_1 = require("./Wallet");
const utils_1 = require("./utils");
const Key_1 = require("./Key");
let normalizedIdentifier;
let normalizedIdentifierSignature;
class CoinTable {
    constructor(balances) {
        if (!initializing && !initialized) {
            throw new Error("Not initialized, use CoinTable.initialize()");
        }
        let coinSum = 0;
        const normalizedBalances = {
            burned: balances.burned
        };
        const addresses = [];
        Object.keys(balances).forEach(addr => {
            coinSum += balances[addr].amount;
            if (addr === "burned") {
                return;
            }
            const norm = utils_1.Convert.Base58.normalize(addr);
            normalizedBalances[norm] = utils_1.deepClone(balances[addr]);
            addresses.push(norm);
        });
        this.addresses = new utils_1.SortedList(addresses, true);
        this.balances = normalizedBalances;
        this.coinSum = coinSum;
        const results = this.verifyTable();
        this.isValid = results.valid;
        this.invalidReason = results.reason;
        this.digest = new Uint8Array(utils_1.hash(this.exportBuffer()));
    }
    verifyTable() {
        let balanceSum = 0;
        const walletAddresses = this.addresses;
        const balances = this.balances;
        const identifyingBalance = this.balances[normalizedIdentifier];
        const hasIdentifier = (identifyingBalance &&
            identifyingBalance.amount === 0 &&
            identifyingBalance.timestamp === 0 &&
            identifyingBalance.signature === utils_1.Convert.Base58.normalize(normalizedIdentifierSignature));
        if (!hasIdentifier) {
            return {
                valid: false,
                reason: "Missing or invalid identifier"
            };
        }
        for (let i = 0; i < walletAddresses.length; i++) {
            const walletAddress = walletAddresses.list[i];
            if (walletAddress === normalizedIdentifier) {
                continue;
            }
            const balance = balances[walletAddress];
            balanceSum += balance.amount;
            if (!Wallet_1.default.verifyBalance(balance, walletAddress)) {
                return {
                    valid: false,
                    reason: "Invalid balance signature"
                };
            }
            if (balanceSum > CoinTable.TOTAL_COINS) {
                return {
                    valid: false,
                    reason: "Invalid coin amount"
                };
            }
            if (balance.timestamp > Date.now()) {
                return {
                    valid: false,
                    reason: "Bad timestamp"
                };
            }
        }
        if (balanceSum !== CoinTable.TOTAL_COINS) {
            return {
                valid: false,
                reason: "Invalid coin amount"
            };
        }
        return {
            valid: true
        };
    }
    applyTransaction(transaction) {
        var _a, _b;
        if (transaction.amount % 1 !== 0) {
            throw new CoinTable.TransactionError("Invalid transaction amount");
        }
        const balances = this.balances;
        transaction.sender = utils_1.Convert.Base58.normalize(transaction.sender);
        transaction.reciever = utils_1.Convert.Base58.normalize(transaction.reciever);
        const senderBalance = utils_1.deepClone((_a = balances[transaction.sender]) !== null && _a !== void 0 ? _a : zeroBalance());
        if (senderBalance.timestamp >= transaction.timestamp) {
            throw new CoinTable.TransactionError("Transaction timestamp is invalid");
        }
        if (senderBalance.amount < transaction.amount) {
            throw new CoinTable.TransactionError("Sender does not have sufficient balance");
        }
        senderBalance.amount -= transaction.amount;
        senderBalance.timestamp = transaction.timestamp;
        senderBalance.signature = transaction.senderSignature;
        if (!Wallet_1.default.verifyBalance(senderBalance, transaction.sender)) {
            throw new CoinTable.TransactionError("Sender signature is invalid");
        }
        const recieverBalance = utils_1.deepClone((_b = balances[transaction.reciever]) !== null && _b !== void 0 ? _b : zeroBalance());
        if (recieverBalance.timestamp >= transaction.timestamp) {
            throw new CoinTable.TransactionError("Transaction timestamp is invalid");
        }
        recieverBalance.amount += transaction.amount;
        recieverBalance.timestamp = transaction.timestamp;
        recieverBalance.signature = transaction.recieverSignature;
        if (!Wallet_1.default.verifyBalance(recieverBalance, transaction.reciever)) {
            throw new CoinTable.TransactionError("Reciever signature is invalid");
        }
        if (!balances[transaction.reciever]) {
            this.addresses.insert(transaction.reciever);
        }
        balances[transaction.sender] = senderBalance;
        balances[transaction.reciever] = recieverBalance;
        this.digest = new Uint8Array(utils_1.hash(this.exportBuffer()));
    }
    exportBuffer() {
        const balances = [];
        for (let i = 0; i < this.addresses.length; i++) {
            const address = this.addresses.list[i];
            const balance = this.balances[address];
            balances.push(utils_1.Buffer.concat(utils_1.Convert.Base58.decodeBuffer(address, Key_1.default.Public.LENGTH), utils_1.Convert.int64ToBuffer(balance.amount), utils_1.Convert.int64ToBuffer(balance.timestamp), utils_1.Convert.Base58.decodeBuffer(balance.signature, Key_1.default.SIG_LENGTH)));
        }
        const balanceSize = Key_1.default.Public.LENGTH + 8 + 8 + Key_1.default.SIG_LENGTH;
        const buffer = new Uint8Array(balances.length * balanceSize);
        balances.forEach((bal, i) => {
            buffer.set(bal, balanceSize * i);
        });
        return utils_1.Buffer.concat(buffer, utils_1.Convert.int64ToBuffer(this.balances.burned.amount));
    }
    static importBuffer(buffer) {
        const balances = {
            burned: {
                amount: 0,
                timestamp: 0,
                signature: ""
            }
        };
        let startIndex = 0;
        while (startIndex < buffer.length - 8) {
            const addressArr = buffer.subarray(startIndex, startIndex += Key_1.default.Public.LENGTH);
            const amount = utils_1.Convert.bufferToInt(buffer.subarray(startIndex, startIndex += 8));
            const timestamp = utils_1.Convert.bufferToInt(buffer.subarray(startIndex, startIndex += 8));
            const sigArr = buffer.subarray(startIndex, startIndex += Key_1.default.SIG_LENGTH);
            const walletAddress = utils_1.Convert.Base58.encode(addressArr);
            const signature = utils_1.Convert.Base58.encode(sigArr);
            balances[walletAddress] = {
                amount: Number(amount),
                timestamp: Number(timestamp),
                signature
            };
        }
        if (startIndex === buffer.length - 8) {
            balances.burned.amount = utils_1.Convert.bufferToInt(buffer.subarray(startIndex, startIndex + 8));
        }
        return new CoinTable(balances);
    }
    static initialize(networkId, totalCoins, subdivision, initialBalances) {
        try {
            const splitId = networkId.split(":");
            if (splitId.length !== 2 || !splitId[0] || !utils_1.Convert.Base58.isEncodedString(splitId[0]) || !splitId[1] || !utils_1.Convert.Base58.isEncodedString(splitId[1])) {
                throw new TypeError("Invalid network ID");
            }
            const identifier = splitId[0];
            const identifierSignature = splitId[1];
            if (totalCoins % 1 !== 0 || totalCoins <= 0) {
                throw new TypeError("Total coins must be a positive integer");
            }
            if (subdivision % 1 !== 0 || subdivision <= 0) {
                throw new TypeError("Subdivision must be a positive integer");
            }
            const balances = utils_1.deepClone(initialBalances);
            if (!balances.burned) {
                balances.burned = { amount: 0, timestamp: 0, signature: "" };
            }
            balances[identifier] = { amount: 0, timestamp: 0, signature: identifierSignature };
            normalizedIdentifier = utils_1.Convert.Base58.normalize(identifier);
            normalizedIdentifierSignature = utils_1.Convert.Base58.normalize(identifierSignature);
            initializing = true;
            const statics = CoinTable;
            statics.identifier = identifier;
            statics.networkId = networkId;
            statics.TOTAL_COINS = totalCoins;
            statics.SUBDIVISION = subdivision;
            statics.initialTable = new CoinTable(balances);
            if (!CoinTable.initialTable.isValid) {
                throw new TypeError("Initial table is invalid (" + CoinTable.initialTable.invalidReason + ")");
            }
            initialized = true;
            initializing = false;
        }
        catch (err) {
            initializing = false;
            throw err;
        }
    }
}
let initializing = false;
let initialized = false;
function zeroBalance() {
    return { amount: 0, timestamp: 0 };
}
(function (CoinTable) {
    class TransactionError extends Error {
    }
    CoinTable.TransactionError = TransactionError;
})(CoinTable || (CoinTable = {}));
exports.default = CoinTable;
//# sourceMappingURL=CoinTable.js.map
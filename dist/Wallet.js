"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
const Key_1 = require("./Key");
class Wallet {
    constructor(privateKey, publicAddress) {
        if (typeof privateKey === "string") {
            this.private = new Key_1.default.Private(privateKey);
        }
        else {
            this.private = privateKey;
        }
        this.public = this.private.getPublic();
        if (typeof publicAddress === "string") {
            if (publicAddress !== this.public.address) {
                throw new Error("Public address incompatible with the private key");
            }
        }
        else if (publicAddress) {
            if (publicAddress.address !== this.public.address) {
                throw new Error("Public address incompatible with the private key");
            }
        }
    }
    signBalance(balance) {
        const balanceCopy = utils_1.deepClone(balance);
        const balanceBuf = utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(balance.amount), utils_1.Convert.int64ToBuffer(balance.timestamp));
        const signature = this.private.sign(balanceBuf);
        balanceCopy.signature = utils_1.Convert.Base58.encode(signature);
        return balanceCopy;
    }
    static verifyBalance(balance, publicKey) {
        const key = new Key_1.default.Public(publicKey);
        const balanceBuf = utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(balance.amount), utils_1.Convert.int64ToBuffer(balance.timestamp));
        return key.verify(balanceBuf, balance.signature);
    }
    createTransaction(amount, reciever) {
        var _a;
        if (!this.node.table) {
            throw new Error("Missing current table");
        }
        const recieverKey = new Key_1.default.Public(reciever);
        if (recieverKey.address === this.public.address) {
            throw new Error("Cannot create a transaction with yourself");
        }
        const currentBalance = this.node.table.balances[this.public.address];
        const currentAmount = (_a = currentBalance === null || currentBalance === void 0 ? void 0 : currentBalance.amount) !== null && _a !== void 0 ? _a : 0;
        if (amount == 0) {
            throw new TypeError("Transaction must have a non-zero amount");
        }
        if (amount % 1 !== 0) {
            throw new TypeError("Transaction must have an integer amount");
        }
        if (amount > currentAmount) {
            throw new RangeError("Insufficient balance");
        }
        const timestamp = Date.now();
        const newBalance = {
            amount: currentAmount - amount,
            timestamp
        };
        const signature = this.signBalance(newBalance).signature;
        const transactionBuf = utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(amount), utils_1.Convert.int64ToBuffer(timestamp), utils_1.Convert.Base58.decodeBuffer(recieverKey.address));
        const transaction = {
            amount, timestamp,
            sender: this.public.address,
            reciever: recieverKey.address,
            senderSignature: signature,
            senderTransactionSignature: utils_1.Convert.Base58.encode(this.private.sign(transactionBuf))
        };
        return transaction;
    }
    signTransaction(transaction) {
        var _a, _b, _c;
        if (!((_a = this.node) === null || _a === void 0 ? void 0 : _a.table)) {
            throw new Error("Missing current table");
        }
        if (transaction.reciever !== this.public.address) {
            throw new Error("Cannot sign transaction, not the recipient");
        }
        transaction = utils_1.deepClone(transaction);
        const currentBalance = this.node.table.balances[this.public.address];
        const currentAmount = (_b = currentBalance === null || currentBalance === void 0 ? void 0 : currentBalance.amount) !== null && _b !== void 0 ? _b : 0;
        const lastTransactionTimestamp = (_c = currentBalance === null || currentBalance === void 0 ? void 0 : currentBalance.timestamp) !== null && _c !== void 0 ? _c : 0;
        if (transaction.timestamp <= lastTransactionTimestamp) {
            throw new Error("Invalid transaction timestamp");
        }
        const amount = transaction.amount;
        if (amount % 1 !== 0 || amount < 1) {
            throw new Error("Invalid transaction amount");
        }
        const transactionBuf = utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(amount), utils_1.Convert.int64ToBuffer(transaction.timestamp), utils_1.Convert.Base58.decodeBuffer(transaction.reciever));
        const verified = new Key_1.default.Public(transaction.sender).verify(transactionBuf, transaction.senderTransactionSignature);
        if (!verified) {
            throw new Error("Unable to verify transaction");
        }
        const newBalance = {
            amount: currentAmount + amount,
            timestamp: transaction.timestamp
        };
        transaction.recieverSignature = this.signBalance(newBalance).signature;
        return transaction;
    }
    signMessage(buf) {
        const signature = this.private.sign(buf, true);
        const concatBuffer = utils_1.Buffer.concat(signature, buf);
        return concatBuffer;
    }
    static verifyMessage(buf, from) {
        const publicKey = new Key_1.default.Public(from);
        const signature = buf.slice(0, Key_1.default.SIG_LENGTH);
        const originalMessage = buf.slice(Key_1.default.SIG_LENGTH);
        const verified = publicKey.verify(originalMessage, signature);
        return { verified, originalMessage };
    }
    static generate() {
        return new Wallet(Key_1.default.Private.generate());
    }
    isValid() {
        const testMessage = "test " + Math.random().toString();
        const signature = this.private.sign(testMessage);
        return this.public.verify(testMessage, signature);
    }
    static importJSON(json, password, progressObj) {
        let jsonObj = json;
        if (typeof json === "string") {
            jsonObj = JSON.parse(json);
        }
        if (jsonObj.salt) {
            if (!password) {
                throw new Error("Missing password");
            }
            const hashIterations = typeof jsonObj.iterations === "number" ? jsonObj.iterations : defaultPasswordHashIterations;
            if (progressObj) {
                return Key_1.default.Private.importEncrypted(jsonObj.privateKey, password, jsonObj.salt, hashIterations, progressObj).then(privateKey => {
                    if (!privateKey) {
                        return null;
                    }
                    return new Wallet(privateKey, jsonObj.publicAddress);
                });
            }
            const privateKey = Key_1.default.Private.importEncrypted(jsonObj.privateKey, password, jsonObj.salt, hashIterations);
            return new Wallet(privateKey, jsonObj.publicAddress);
        }
        const wallet = new Wallet(jsonObj.privateKey, jsonObj.publicAddress);
        return wallet;
    }
    exportJSON(password, iterations, progressObj) {
        const hashIterations = iterations !== null && iterations !== void 0 ? iterations : defaultPasswordHashIterations;
        if (password) {
            const salt = Math.random().toString(36).slice(2);
            if (progressObj) {
                return this.private.exportEncrypted(password, salt, hashIterations, progressObj).then(privateKey => {
                    if (!privateKey) {
                        return null;
                    }
                    return {
                        publicAddress: this.public.address,
                        privateKey: privateKey,
                        salt,
                        iterations: hashIterations
                    };
                });
            }
            return {
                publicAddress: this.public.address,
                privateKey: this.private.exportEncrypted(password, salt, hashIterations),
                salt,
                iterations: hashIterations
            };
        }
        if (progressObj) {
            progressObj.progress = 1;
            return new Promise(r => r({
                publicAddress: this.public.address,
                privateKey: this.private.toString()
            }));
        }
        return {
            publicAddress: this.public.address,
            privateKey: this.private.toString()
        };
    }
}
const defaultPasswordHashIterations = 15000;
exports.default = Wallet;
//# sourceMappingURL=Wallet.js.map
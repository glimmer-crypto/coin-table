"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
const Key_1 = require("./Key");
const elliptic_1 = require("elliptic");
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
        if (transaction.timestamp > Date.now()) {
            throw new Error("Cannot sign transaction from the future");
        }
        transaction = utils_1.deepClone(transaction);
        const senderBalance = this.node.table.balances[transaction.sender];
        if (!senderBalance || senderBalance.amount < transaction.amount) {
            throw new Error("Transaction sender does not have enough funds");
        }
        const currentBalance = this.node.table.balances[this.public.address];
        const currentAmount = (_b = currentBalance === null || currentBalance === void 0 ? void 0 : currentBalance.amount) !== null && _b !== void 0 ? _b : 0;
        const lastTransactionTimestamp = (_c = currentBalance === null || currentBalance === void 0 ? void 0 : currentBalance.timestamp) !== null && _c !== void 0 ? _c : 0;
        if (transaction.timestamp <= lastTransactionTimestamp || transaction.timestamp <= senderBalance.timestamp) {
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
    static verifyConfirmationTransaction(transaction) {
        const transactionBuf = utils_1.Buffer.concat(utils_1.Convert.int64ToBuffer(transaction.amount), utils_1.Convert.int64ToBuffer(transaction.timestamp), utils_1.Convert.Base58.decodeBuffer(transaction.reciever));
        try {
            return new Key_1.default.Public(transaction.sender).verify(transactionBuf, transaction.senderTransactionSignature);
        }
        catch (err) {
            console.error(err);
            return false;
        }
    }
    verifyTransaction(transaction) {
        if (!this.node.table) {
            throw new Error("Missing current table");
        }
        if (transaction.amount % 1 !== 0) {
            return false;
        }
        const balances = this.node.table.balances;
        transaction.sender = utils_1.Convert.Base58.normalize(transaction.sender);
        transaction.reciever = utils_1.Convert.Base58.normalize(transaction.reciever);
        const senderBalance = utils_1.deepClone(balances[transaction.sender]);
        if (!senderBalance) {
            return false;
        }
        if (senderBalance.timestamp >= transaction.timestamp) {
            return false;
        }
        if (senderBalance.amount < transaction.amount) {
            return false;
        }
        senderBalance.amount -= transaction.amount;
        senderBalance.timestamp = transaction.timestamp;
        senderBalance.signature = transaction.senderSignature;
        if (!Wallet.verifyBalance(senderBalance, transaction.sender)) {
            return false;
        }
        let recieverBalance = utils_1.deepClone(balances[transaction.reciever]);
        if (recieverBalance) {
            if (recieverBalance.timestamp >= transaction.timestamp) {
                return false;
            }
            recieverBalance.amount += transaction.amount;
            recieverBalance.timestamp = transaction.timestamp;
            recieverBalance.signature = transaction.recieverSignature;
        }
        else {
            recieverBalance = {
                amount: transaction.amount,
                timestamp: transaction.timestamp,
                signature: transaction.recieverSignature
            };
        }
        if (!Wallet.verifyBalance(recieverBalance, transaction.reciever)) {
            return false;
        }
        return true;
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
    static fromSeedPhrase(seed, password = "", progressObj) {
        const json = {
            privateKey: "11111111111111111111111111111111111111111111",
            salt: "seed",
            iterations: 100000
        };
        const fullSeed = seed + ":" + password;
        if (progressObj) {
            return Wallet.importJSON(json, fullSeed, progressObj);
        }
        else {
            return Wallet.importJSON(json, fullSeed);
        }
    }
}
const defaultPasswordHashIterations = 15000;
(function (Wallet) {
    class WordList {
        constructor(wordlist) {
            this.alphabet = new Set();
            this.wordlist = wordlist;
            this.count = wordlist.length;
            this.bncount = new utils_1.BN(wordlist.length);
            let minLength = Infinity;
            let maxLength = 0;
            wordlist.forEach(word => {
                if (word.length < minLength) {
                    minLength = word.length;
                }
                if (word.length > maxLength) {
                    maxLength = word.length;
                }
                word.split("").forEach(char => this.alphabet.add(char));
            });
            this.minLength = minLength;
            this.maxLength = maxLength;
        }
        generateSeedPhrase() {
            const randomBytes = elliptic_1.rand(17);
            const bigNum = new utils_1.BN(randomBytes);
            const words = [];
            for (let i = 0; i < 12; i++) {
                const wordIndex = bigNum.mod(this.bncount).toNumber();
                words.push(this.wordlist[wordIndex]);
                bigNum.idivn(this.count);
            }
            return words.join(" ");
        }
        normalizeSeedPhrase(seed) {
            const normalizeSpaces = seed.trim().replace(/\s+/g, " ");
            const words = normalizeSpaces.split(" ");
            if (words.length !== 12 || words.some(word => word.length < this.minLength || word.length > this.maxLength)) {
                return null;
            }
            const normalizeCase = normalizeSpaces.toLowerCase();
            if (!normalizeCase.split("").every(char => char === " " || this.alphabet.has(char))) {
                return null;
            }
            return normalizeCase;
        }
    }
    Wallet.WordList = WordList;
})(Wallet || (Wallet = {}));
exports.default = Wallet;
//# sourceMappingURL=Wallet.js.map
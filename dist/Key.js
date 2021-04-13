"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Key = void 0;
const hash_js_1 = require("hash.js");
const utils_1 = require("./utils");
const elliptic = require("elliptic");
const ec = new elliptic.ec("secp256k1");
function checksum(data, modulo) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum = (sum + data[i]) % modulo;
    }
    return sum;
}
const MB = 1024 * 1024;
function kdf(input, iterations) {
    const sha = hash_js_1.sha512();
    sha.update(input);
    const expanded = new Uint8Array(MB);
    expanded.set(sha.digest());
    let digestLength = 64;
    let digestIndex = 0;
    let setIndex = 0;
    for (let i = 0; i < iterations; i++) {
        digestIndex = digestIndex % (MB - 64) % digestLength;
        sha.update(expanded.subarray(digestIndex, digestIndex + 64));
        sha.update(utils_1.Convert.int64ToBuffer(i));
        const hashResult = sha.digest();
        const int32Arr = new Uint32Array(new Uint8Array(hashResult).buffer);
        let indexChange = 0;
        for (let i = 0; i < 16; i++) {
            indexChange ^= int32Arr[i];
        }
        digestIndex += indexChange >>> 0;
        setIndex += 64;
        if (setIndex >= MB) {
            setIndex = 0;
        }
        expanded.set(hashResult, setIndex);
        digestLength += 64;
    }
    digestIndex = digestIndex % (digestLength - 64);
    return expanded.slice(digestIndex, digestIndex + 64);
}
function kdfWithProgress(input, iterations, progressObj) {
    return new Promise(resolve => {
        const sha = hash_js_1.sha512();
        sha.update(input);
        const expanded = new Uint8Array(MB);
        expanded.set(sha.digest());
        let digestLength = 64;
        let digestIndex = 0;
        let setIndex = 0;
        let i = 0;
        const hashIteration = () => {
            const chunkIterations = Math.max(25, iterations / 100);
            for (let j = 0; j < chunkIterations; j++) {
                digestIndex = digestIndex % (MB - 64) % digestLength;
                sha.update(expanded.subarray(digestIndex, digestIndex + 64));
                sha.update(utils_1.Convert.int64ToBuffer(i));
                const hashResult = sha.digest();
                const int32Arr = new Uint32Array(new Uint8Array(hashResult).buffer);
                let indexChange = 0;
                for (let i = 0; i < 16; i++) {
                    indexChange ^= int32Arr[i];
                }
                digestIndex += indexChange >>> 0;
                setIndex += 64;
                if (setIndex >= MB) {
                    setIndex = 0;
                }
                expanded.set(hashResult, setIndex);
                digestLength += 64;
                i++;
                if (i >= iterations) {
                    break;
                }
            }
            if (progressObj.stop === true) {
                return resolve(null);
            }
            progressObj.progress = i / iterations;
            if (i < iterations) {
                setTimeout(hashIteration, 0);
            }
            else {
                digestIndex = digestIndex % (digestLength - 64);
                resolve(expanded.slice(digestIndex, digestIndex + 64));
            }
        };
        setTimeout(hashIteration, 0);
    });
}
var Key;
(function (Key) {
    Key.SIG_LENGTH = 71;
    class Public {
        constructor(data) {
            if (data instanceof Public) {
                return data;
            }
            let buffer;
            if (typeof data === "string") {
                buffer = utils_1.Convert.Base58.decodeBuffer(data);
                this.address = utils_1.Convert.Base58.normalize(data);
            }
            else {
                buffer = data;
                this.address = utils_1.Convert.Base58.encode(data);
            }
            const version = buffer[0];
            if (version !== 1) {
                throw new Error("Not a valid address (unknown version)");
            }
            const x = buffer.slice(1, -1);
            const checkByte = buffer[buffer.length - 1];
            const yIsOdd = !!(checkByte >> 7);
            const checksumBits = checkByte & 127;
            const point = ec.curve.pointFromX(x, yIsOdd);
            this.point = point;
            this.keyPair = ec.keyFromPublic(point);
            this.checksum = checksum(point.encode("array", false), 127);
            if (this.checksum !== checksumBits) {
                throw new Error("Not a valid address (checksum doesn't match)");
            }
        }
        verify(data, signature) {
            const digest = utils_1.hash(data);
            let sig;
            if (typeof signature === "string") {
                sig = utils_1.Convert.Base58.decodeBuffer(signature);
            }
            else {
                sig = signature;
            }
            sig = utils_1.Buffer.unpad(sig);
            // console.log(Convert.bufferToHex(Buffer.concat([0x30], sig)))
            return this.keyPair.verify(digest, utils_1.Buffer.concat([0x30], sig));
        }
        toString() {
            return this.address;
        }
        toJSON() {
            return this.address;
        }
    }
    Public.LENGTH = 34;
    Key.Public = Public;
    class Private {
        constructor(data) {
            if (data instanceof Private) {
                return data;
            }
            let buffer;
            if (typeof data === "string") {
                buffer = utils_1.Convert.Base58.decodeBuffer(data);
                this.stringRepresentation = data;
            }
            else {
                buffer = data;
                this.stringRepresentation = utils_1.Convert.Base58.encode(data);
            }
            this.keyPair = ec.keyFromPrivate(buffer);
        }
        static generate() {
            const keyPair = ec.genKeyPair();
            return new Private(keyPair.getPrivate().toArray());
        }
        getPublic() {
            if (this._cachedPublic) {
                return this._cachedPublic;
            }
            const pub = this.keyPair.getPublic();
            const x = pub.getX();
            const y = pub.getY();
            const arr = x.toArray();
            const checksumBits = checksum(pub.encode("array", false), 127);
            const checkByte = (y.isOdd() ? 128 : 0) | checksumBits;
            arr.push(checkByte);
            return new Public([1].concat(arr));
        }
        sign(data, fixedLength = false) {
            const digest = utils_1.hash(data);
            const signature = this.keyPair.sign(digest).toDER().slice(1);
            // console.log(Convert.bufferToHex(this.keyPair.sign(digest).toDER()))
            if (fixedLength) {
                return utils_1.Buffer.pad(signature, Key.SIG_LENGTH);
            }
            else {
                return new Uint8Array(signature);
            }
        }
        derive(pub) {
            const publicKey = new Public(pub);
            return new Uint8Array(this.keyPair.derive(publicKey["point"]).toArray());
        }
        exportEncrypted(password, salt, iterations, progressObj) {
            let keyNum = this.keyPair.getPrivate();
            if (progressObj) {
                progressObj.progress = 0;
                return kdfWithProgress(password + salt, iterations, progressObj).then(digest => {
                    if (!digest) {
                        return null;
                    }
                    const passKey = new utils_1.BN(digest.slice(0, 32));
                    keyNum = keyNum.uxor(passKey);
                    return utils_1.Convert.Base58.encode(keyNum);
                });
            }
            const digest = kdf(password + salt, iterations);
            const passKey = new utils_1.BN(digest.slice(0, 32));
            return utils_1.Convert.Base58.encode(keyNum.uxor(passKey));
        }
        static importEncrypted(encryptedVal, password, salt, iterations, progressObj) {
            const encryptedNum = utils_1.Convert.Base58.decodeNumber(encryptedVal);
            if (progressObj) {
                return kdfWithProgress(password + salt, iterations, progressObj).then(digest => {
                    if (!digest) {
                        return null;
                    }
                    const passKey = new utils_1.BN(digest.slice(0, 32));
                    return new Key.Private(encryptedNum.uxor(passKey).toArray());
                });
            }
            const digest = kdf(password + salt, iterations);
            const passKey = new utils_1.BN(digest.slice(0, 32));
            return new Key.Private(encryptedNum.uxor(passKey).toArray());
        }
        toString() {
            return this.stringRepresentation;
        }
        toJSON() {
            return this.stringRepresentation;
        }
    }
    Key.Private = Private;
})(Key = exports.Key || (exports.Key = {}));
exports.default = Key;
//# sourceMappingURL=Key.js.map
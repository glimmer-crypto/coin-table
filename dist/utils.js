"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Buffer = exports.Convert = exports.EventTarget = exports.SortedList = exports.Random = exports.shuffle = exports.deepClone = exports.XorCipher = exports.hash = exports.BN = void 0;
const BigNum = require("bn.js");
const hash_js_1 = require("hash.js");
const elliptic_1 = require("elliptic");
exports.BN = BigNum;
function hash(message) {
    return hash_js_1.sha512().update(message).digest();
}
exports.hash = hash;
var XorCipher;
(function (XorCipher) {
    function encrypt(plaintext, key) {
        const salt = new Uint8Array(new Uint32Array([
            Math.ceil(Math.random() * 0xFFFFFFFF),
            Math.ceil(Math.random() * 0xFFFFFFFF),
            Math.ceil(Math.random() * 0xFFFFFFFF),
            Math.ceil(Math.random() * 0xFFFFFFFF)
        ]).buffer);
        const ciphertext = new Uint8Array(plaintext.length + 16);
        ciphertext.set(salt, plaintext.length);
        const md = hash_js_1.sha512();
        const extendedKey = new Uint8Array(64);
        for (let i = 0; i < plaintext.length; i++) {
            const keyIndex = i % 64;
            if (keyIndex === 0) {
                md.update(key);
                md.update(salt);
                md.update(extendedKey);
                extendedKey.set(md.digest());
            }
            ciphertext[i] = plaintext[i] ^ extendedKey[keyIndex];
        }
        return ciphertext;
    }
    XorCipher.encrypt = encrypt;
    function decrypt(ciphertext, key) {
        const salt = ciphertext.slice(-16);
        const plaintext = new Uint8Array(ciphertext.length - 16);
        const md = hash_js_1.sha512();
        const extendedKey = new Uint8Array(64);
        for (let i = 0; i < plaintext.length; i++) {
            const keyIndex = i % 64;
            if (keyIndex === 0) {
                md.update(key);
                md.update(salt);
                md.update(extendedKey);
                extendedKey.set(md.digest());
            }
            plaintext[i] = ciphertext[i] ^ extendedKey[keyIndex];
        }
        return plaintext;
    }
    XorCipher.decrypt = decrypt;
})(XorCipher = exports.XorCipher || (exports.XorCipher = {}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepClone(object, newObject = {}) {
    if (object === null) {
        return null;
    }
    if (object === undefined) {
        return undefined;
    }
    for (const key in object) {
        const value = object[key];
        if (typeof value === "object" && value !== null) {
            const newValue = {};
            newObject[key] = newValue;
            deepClone(value, newValue);
        }
        else {
            newObject[key] = value;
        }
    }
    return newObject;
}
exports.deepClone = deepClone;
function shuffle(array) {
    let currentIndex = array.length, temporaryValue, randomIndex;
    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }
    return array;
}
exports.shuffle = shuffle;
exports.Random = {
    mulberry32(seed) {
        return function () {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    },
    crypto: elliptic_1.rand
};
class SortedList {
    constructor(uniqueOrInitialList = false, unique = false) {
        this.list = [];
        if (typeof uniqueOrInitialList === "boolean") {
            this.unique = uniqueOrInitialList;
        }
        else {
            const list = uniqueOrInitialList.slice().sort((a, b) => {
                if (a < b) {
                    return -1;
                }
                else if (a > b) {
                    return 1;
                }
                else {
                    return 0;
                }
            });
            this.list = list;
            this.unique = unique;
            if (unique) {
                let index = 0;
                const length = list.length;
                for (let i = 0; i < length; i++) {
                    if (list[index] === list[index - 1]) {
                        list.splice(index, 1);
                    }
                    else {
                        index += 1;
                    }
                }
            }
        }
    }
    get length() {
        return this.list.length;
    }
    [Symbol.iterator]() {
        return this.list[Symbol.iterator]();
    }
    indexOf(value) {
        const list = this.list;
        let lower = 0;
        let upper = list.length - 1;
        let index = 0;
        while (lower <= upper) {
            index = Math.floor((upper + lower) / 2);
            const item = list[index];
            if (value > item) {
                lower = index + 1;
            }
            else if (value < item) {
                upper = index - 1;
            }
            else {
                return index;
            }
        }
        return -1;
    }
    indexOfNearby(value) {
        const list = this.list;
        let lower = 0;
        let upper = list.length - 1;
        let index = -1;
        while (lower <= upper) {
            index = Math.floor((upper + lower) / 2);
            const item = list[index];
            if (value > item) {
                lower = index + 1;
            }
            else if (value < item) {
                upper = index - 1;
            }
            else {
                return index;
            }
        }
        return index;
    }
    insert(newValue) {
        const list = this.list;
        let lower = 0;
        let upper = list.length - 1;
        let index = 0;
        while (lower <= upper) {
            index = Math.floor((upper + lower) / 2);
            const item = list[index];
            if (newValue > item) {
                lower = index + 1;
                index += 1;
            }
            else if (newValue < item) {
                upper = index - 1;
            }
            else {
                if (!this.unique) {
                    list.splice(index, 0, newValue);
                    return true;
                }
                return false;
            }
        }
        list.splice(index, 0, newValue);
        return true;
    }
    static fromAlreadySorted(list, unique = false) {
        const newList = new SortedList(unique);
        const mutable = newList;
        mutable.list = list.slice();
        return newList;
    }
    clone() {
        return SortedList.fromAlreadySorted(this.list, this.unique);
    }
}
exports.SortedList = SortedList;
// eslint-disable-next-line @typescript-eslint/ban-types
class EventTarget {
    constructor() {
        this.listeners = {};
    }
    on(eventName, listener) {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.listeners[eventName].push(listener.bind(this));
    }
    dispatchEvent(eventName, ...value) {
        var _a;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        (_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.forEach(listener => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            listener(value[0]);
        });
    }
}
exports.EventTarget = EventTarget;
var Convert;
(function (Convert) {
    function int32ToBuffer(num) {
        return new Uint8Array(new Uint32Array([num & 0xFFFFFFFF]).buffer);
    }
    Convert.int32ToBuffer = int32ToBuffer;
    function int64ToBuffer(num) {
        return new Uint8Array(new Uint32Array([
            num & 0xFFFFFFFF,
            Math.floor(num / (0xFFFFFFFF + 1))
        ]).buffer);
    }
    Convert.int64ToBuffer = int64ToBuffer;
    function bufferToInt(buf) {
        const arr = new Uint32Array(buf.slice().buffer);
        if (arr.length === 1) {
            return arr[0];
        }
        else {
            return arr[0] + (arr[1] * (0xFFFFFFFF + 1));
        }
    }
    Convert.bufferToInt = bufferToInt;
    function hexToFixedLengthBuffer(hex, length) {
        const initialBuffer = hexToBuffer(hex);
        const buffer = new Uint8Array(length);
        buffer.set(initialBuffer, length - initialBuffer.length);
        return buffer;
    }
    Convert.hexToFixedLengthBuffer = hexToFixedLengthBuffer;
    function fixedLengthBufferToHex(buf) {
        let hex = bufferToHex(buf.slice());
        while (hex[0] == "0" && hex[1] == "0") { // Remove leading zeros
            hex = hex.slice(2);
        }
        return hex;
    }
    Convert.fixedLengthBufferToHex = fixedLengthBufferToHex;
    function stringToBuffer(str, simple = false) {
        const stringArr = simple ? new Uint8Array(str.length) : new Uint16Array(str.length);
        for (let i = 0, strLen = str.length; i < strLen; i++) {
            stringArr[i] = str.charCodeAt(i);
        }
        return new Uint8Array(stringArr.buffer);
    }
    Convert.stringToBuffer = stringToBuffer;
    function bufferToString(buf, simple = false) {
        const stringArr = simple ? new Uint8Array(buf.slice().buffer) : new Uint16Array(buf.slice().buffer);
        let string = "";
        for (let i = 0; i < stringArr.length; i++) {
            string += String.fromCharCode(stringArr[i]);
        }
        return string;
    }
    Convert.bufferToString = bufferToString;
    function hexToBuffer(hex) {
        return new Uint8Array(new exports.BN(hex, "hex").toArray());
    }
    Convert.hexToBuffer = hexToBuffer;
    function bufferToHex(buf) {
        let hex = "";
        for (let i = 0; i < buf.length; i++) {
            const byte = buf[i];
            if (byte < 0x10) {
                hex += "0";
            }
            hex += byte.toString(16);
        }
        return hex;
    }
    Convert.bufferToHex = bufferToHex;
    class BaseNumeralData {
        constructor(encodeDigits, caseInsensitiveDecode = true) {
            this.encodeDigits = encodeDigits;
            this.decodeDigits = {};
            const allLowerCase = caseInsensitiveDecode && encodeDigits.toLowerCase() === encodeDigits;
            const allUpperCase = caseInsensitiveDecode && encodeDigits.toUpperCase() === encodeDigits;
            for (let i = 0; i < encodeDigits.length; i++) {
                const digit = encodeDigits[i];
                this.decodeDigits[digit] = i;
                if (allLowerCase) {
                    this.decodeDigits[digit.toUpperCase()] = i;
                }
                else if (allUpperCase) {
                    this.decodeDigits[digit.toLowerCase()] = i;
                }
            }
        }
    }
    class BaseConverter {
        constructor(data) {
            this.encodeDigits = data.encodeDigits;
            this.decodeDigits = data.decodeDigits;
            this.base = data.encodeDigits.length;
            this.bigBase = new exports.BN(data.encodeDigits.length);
        }
        encode(num) {
            let outStr = "";
            const bn = num instanceof exports.BN ? num.clone() : new exports.BN(num);
            while (bn.gten(this.base)) {
                const remainder = bn.modn(this.base);
                bn.idivn(this.base);
                outStr = this.encodeDigits[remainder] + outStr;
            }
            outStr = this.encodeDigits[bn.toNumber()] + outStr;
            return outStr;
        }
        decodeBuffer(str, length) {
            return new Uint8Array(this.decodeNumber(str).toArray(undefined, length));
        }
        decodeNumber(str) {
            if (!this.isEncodedString(str)) {
                throw new Error("String is not a valid encoding");
            }
            const outNum = new exports.BN(0);
            for (let i = 0; i < str.length; i++) {
                const digit = str[i];
                const place = this.bigBase.pow(new exports.BN(str.length - i - 1));
                const val = this.decodeDigits[digit];
                outNum.iadd(place.muln(val));
            }
            return outNum;
        }
        isEncodedString(str) {
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                if (this.decodeDigits[char] === undefined) {
                    return false;
                }
            }
            return true;
        }
        normalize(str) {
            let normalized = "";
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                normalized += this.encodeDigits[this.decodeDigits[char]];
            }
            return normalized;
        }
    }
    const base58Data = new BaseNumeralData("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
    base58Data.decodeDigits["0"] = base58Data.decodeDigits["O"] = base58Data.decodeDigits["o"];
    base58Data.decodeDigits["I"] = base58Data.decodeDigits["l"] = base58Data.decodeDigits["1"];
    Convert.Base58 = new BaseConverter(base58Data);
})(Convert = exports.Convert || (exports.Convert = {}));
var Buffer;
(function (Buffer) {
    function concat(...buffers) {
        let totalLength = 0;
        for (let i = 0; i < buffers.length; i++) {
            totalLength += buffers[i].length;
        }
        const returnBuffer = new Uint8Array(totalLength);
        let currentLength = 0;
        for (let i = 0; i < buffers.length; i++) {
            const buffer = buffers[i];
            returnBuffer.set(buffer, currentLength);
            currentLength += buffer.length;
        }
        return returnBuffer;
    }
    Buffer.concat = concat;
    function pad(buffer, padLength) {
        const returnBuffer = new Uint8Array(padLength);
        returnBuffer.set(buffer, padLength - buffer.length);
        return returnBuffer;
    }
    Buffer.pad = pad;
    function unpad(buffer) {
        let startIndex = 0;
        while (buffer[startIndex] === 0) {
            startIndex += 1;
        }
        if (buffer instanceof Uint8Array) {
            return buffer.slice(startIndex);
        }
        else {
            return new Uint8Array(buffer.slice(startIndex));
        }
    }
    Buffer.unpad = unpad;
    function equal(...buffers) {
        const length = buffers[0].length;
        for (let i = 1; i < buffers.length; i++) {
            if (buffers[i].length !== length) {
                return false;
            }
        }
        for (let i = 0; i < length; i++) {
            const value = buffers[0][i];
            for (let j = 1; j < buffers.length; j++) {
                if (buffers[j][i] !== value) {
                    return false;
                }
            }
        }
        return true;
    }
    Buffer.equal = equal;
})(Buffer = exports.Buffer || (exports.Buffer = {}));
//# sourceMappingURL=utils.js.map
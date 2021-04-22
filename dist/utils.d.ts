import * as BigNum from "bn.js";
export declare type BN = BigNum;
export declare const BN: typeof BigNum;
export declare function hash(message: string | BufferLike): number[];
export declare namespace XorCipher {
    function encrypt(plaintext: BufferLike, key: BufferLike): Uint8Array;
    function decrypt(ciphertext: BufferLike, key: BufferLike): Uint8Array;
}
export declare function deepClone<T extends Record<string, any> | undefined | null>(object: T, newObject?: Record<string, any>): T;
export declare function shuffle<T>(array: Array<T>): Array<T>;
export declare function shuffledLoop<T>(iterable: Iterable<T>): Generator<T, void, unknown>;
export declare const Random: {
    mulberry32(seed: number): () => number;
    crypto: (bytes: number) => Uint8Array;
};
export declare class SortedList<Item extends string | number> implements Iterable<Item> {
    readonly unique: boolean;
    readonly list: Item[];
    get length(): number;
    constructor(unique?: boolean);
    constructor(initialList: Item[], unique?: boolean);
    [Symbol.iterator](): Iterator<Item, unknown, undefined>;
    indexOf(value: Item): number;
    indexOfNearby(value: Item): number;
    insert(newValue: Item): boolean;
    static fromAlreadySorted<Item extends string | number>(list: Item[], unique?: boolean): SortedList<Item>;
    clone(): SortedList<Item>;
}
export declare class EventTarget<EventTypes extends object> {
    private readonly listeners;
    on<EventName extends keyof EventTypes>(eventName: EventName, listener: (this: this, value: EventTypes[EventName]) => void): void;
    dispatchEvent<EventName extends keyof EventTypes>(eventName: EventName, ...value: EventTypes[EventName] extends undefined ? [] : [EventTypes[EventName]]): void;
}
export declare namespace Convert {
    export function int32ToBuffer(num: number): Uint8Array;
    export function int64ToBuffer(num: number): Uint8Array;
    export function bufferToInt(buf: Uint8Array): number;
    export function hexToFixedLengthBuffer(hex: string, length: number): Uint8Array;
    export function fixedLengthBufferToHex(buf: BufferLike): string;
    export function stringToBuffer(str: string, simple?: boolean): Uint8Array;
    export function bufferToString(buf: Uint8Array, simple?: boolean): string;
    export function hexToBuffer(hex: string): Uint8Array;
    export function bufferToHex(buf: BufferLike): string;
    class BaseNumeralData {
        readonly encodeDigits: string;
        readonly decodeDigits: Record<string, number>;
        constructor(encodeDigits: string, caseInsensitiveDecode?: boolean);
    }
    class BaseConverter {
        private readonly encodeDigits;
        private readonly decodeDigits;
        private readonly base;
        private readonly bigBase;
        constructor(data: BaseNumeralData);
        encode(num: BufferLike | BN): string;
        decodeBuffer(str: string, length?: number): Uint8Array;
        decodeNumber(str: string): BN;
        isEncodedString(str: string): boolean;
        normalize(str: string): string;
    }
    export const Base58: BaseConverter;
    export {};
}
export declare namespace Buffer {
    function concat(...buffers: (BufferLike)[]): Uint8Array;
    function pad(buffer: BufferLike, padLength: number): Uint8Array;
    function unpad(buffer: BufferLike): Uint8Array;
    function equal(...buffers: BufferLike[]): boolean;
}
declare type BufferLike = Uint8Array | number[];
export declare type DeepReadonly<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};
export {};

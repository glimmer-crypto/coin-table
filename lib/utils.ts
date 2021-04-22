import * as BigNum from "bn.js"
import { sha512 } from "hash.js"
import { rand } from "elliptic"

export type BN = BigNum
export const BN = BigNum

export function hash(message: string | BufferLike): number[] {
  return sha512().update(message).digest()
}

export namespace XorCipher {
  export function encrypt(plaintext: BufferLike, key: BufferLike): Uint8Array {
    const salt = new Uint8Array(new Uint32Array([ // 128 bit salt
      Math.ceil(Math.random() * 0xFFFFFFFF),
      Math.ceil(Math.random() * 0xFFFFFFFF),
      Math.ceil(Math.random() * 0xFFFFFFFF),
      Math.ceil(Math.random() * 0xFFFFFFFF)
    ]).buffer)
    const ciphertext = new Uint8Array(plaintext.length + 16)
    
    ciphertext.set(salt, plaintext.length)
  
    const md = sha512()
    const extendedKey = new Uint8Array(64)
    for (let i = 0; i < plaintext.length; i++) {
      const keyIndex = i % 64
      if (keyIndex === 0) {
        md.update(key)
        md.update(salt)
        md.update(extendedKey)
        extendedKey.set(md.digest())
      }
  
      ciphertext[i] = plaintext[i] ^ extendedKey[keyIndex]
    }
  
    return ciphertext
  }
  
  export function decrypt(ciphertext: BufferLike, key: BufferLike): Uint8Array {
    const salt = ciphertext.slice(-16)
    const plaintext = new Uint8Array(ciphertext.length - 16)
  
    const md = sha512()
    const extendedKey = new Uint8Array(64)
    for (let i = 0; i < plaintext.length; i++) {
      const keyIndex = i % 64
      if (keyIndex === 0) {
        md.update(key)
        md.update(salt)
        md.update(extendedKey)
        extendedKey.set(md.digest())
      }
  
      plaintext[i] = ciphertext[i] ^ extendedKey[keyIndex]
    }
  
    return plaintext
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepClone<T extends Record<string, any> | undefined | null>(object: T, newObject: Record<string, any> = {}): T {
  if (object === null) { return null as unknown as T }
  if (object === undefined) { return undefined as unknown as T }

  for (const key in object) {
    const value = object[key]
    if (typeof value === "object" && value !== null) {
      const newValue = {}
      newObject[key] = newValue
      deepClone(value, newValue)
    } else {
      newObject[key] = value
    }
  }

  return newObject as T
}

export function shuffle<T>(array: Array<T>): Array<T> {
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

export function* shuffledLoop<T>(iterable: Iterable<T>): Generator<T, void, unknown> {
  let array: T[]
  if (Array.isArray(iterable)) {
    array = iterable.slice()
  } else {
    array = Array.from(iterable)
  }

  const length = array.length
  for (let i = 0; i < length; i++) {
    const index = Math.floor(Math.random() * array.length)
    yield array.splice(index, 1)[0]
  }
}

export const Random = {
  mulberry32(seed: number) {
    return function(): number {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  },
  crypto: rand as (bytes: number) => Uint8Array
}

export class SortedList<Item extends string | number> implements Iterable<Item> {
  readonly unique: boolean
  readonly list: Item[] = []
  get length(): number {
    return this.list.length
  }

  constructor(unique?: boolean)
  constructor(initialList: Item[], unique?: boolean)
  constructor(uniqueOrInitialList: Item[] | boolean = false, unique = false) {
    if (typeof uniqueOrInitialList === "boolean") {
      this.unique = uniqueOrInitialList
    } else {
      const list = uniqueOrInitialList.slice().sort((a, b) => {
        if (a < b) {
          return -1
        } else if (a > b) {
          return 1
        } else {
          return 0
        }
      })

      this.list = list
      this.unique = unique

      if (unique) {
        let index = 0
        const length = list.length
        for (let i = 0; i < length; i++) {
          if (list[index] === list[index - 1]) {
            list.splice(index, 1)
          } else {
            index += 1
          }
        }
      }
    }
  }

  [Symbol.iterator](): Iterator<Item, unknown, undefined> {
    return this.list[Symbol.iterator]()
  }

  indexOf(value: Item): number {
    const list = this.list

    let lower = 0
    let upper = list.length - 1
    let index = 0

    while (lower <= upper) {
      index = Math.floor((upper + lower) / 2)
      const item = list[index]

      if (value > item) {
        lower = index + 1
      } else if (value < item) {
        upper = index - 1
      } else {
        return index
      }
    }

    return -1
  }

  indexOfNearby(value: Item): number {
    const list = this.list

    let lower = 0
    let upper = list.length - 1
    let index = -1

    while (lower <= upper) {
      index = Math.floor((upper + lower) / 2)
      const item = list[index]

      if (value > item) {
        lower = index + 1
      } else if (value < item) {
        upper = index - 1
      } else {
        return index
      }
    }

    return index
  }

  insert(newValue: Item): boolean {
    const list = this.list

    let lower = 0
    let upper = list.length - 1
    let index = 0

    while (lower <= upper) {
      index = Math.floor((upper + lower) / 2)
      const item = list[index]

      if (newValue > item) {
        lower = index + 1
        index += 1
      } else if (newValue < item) {
        upper = index - 1
      } else {
        if (!this.unique) {
          list.splice(index, 0, newValue)
          return true
        }

        return false
      }
    }

    list.splice(index, 0, newValue)
    return true
  }

  static fromAlreadySorted<Item extends string | number>(list: Item[], unique = false): SortedList<Item> {
    const newList = new SortedList<Item>(unique);
    const mutable = newList as { list: Item[] }
    mutable.list = list.slice()
    
    return newList
  }

  clone(): SortedList<Item> {
    return SortedList.fromAlreadySorted(this.list, this.unique)
  }
}

// eslint-disable-next-line @typescript-eslint/ban-types
export class EventTarget<EventTypes extends object> {
  private readonly listeners: { [EventName in keyof EventTypes]?: ((value: EventTypes[EventName]) => void)[] } = {}

  on<EventName extends keyof EventTypes>(eventName: EventName, listener: (this: this, value: EventTypes[EventName]) => void): void {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = []
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.listeners[eventName].push(listener.bind(this))
  }

  dispatchEvent<EventName extends keyof EventTypes>(eventName: EventName, ...value: EventTypes[EventName] extends undefined ? [] : [EventTypes[EventName]]): void {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.listeners[eventName]?.forEach(listener => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      listener(value[0])
    })
  }
}

export namespace Convert {
  export function int32ToBuffer(num: number): Uint8Array {
    return new Uint8Array(new Uint32Array([num & 0xFFFFFFFF]).buffer)
  }

  export function int64ToBuffer(num: number): Uint8Array {
    return new Uint8Array(new Uint32Array([
      num & 0xFFFFFFFF,
      Math.floor(num / (0xFFFFFFFF + 1))
    ]).buffer)
  }

  export function bufferToInt(buf: Uint8Array): number {
    const arr = new Uint32Array(buf.slice().buffer)
    if (arr.length === 1) {
      return arr[0]
    } else {
      return arr[0] + (arr[1] * (0xFFFFFFFF + 1))
    }
  }

  export function hexToFixedLengthBuffer(hex: string, length: number): Uint8Array {
    const initialBuffer = hexToBuffer(hex)
    const buffer = new Uint8Array(length)
    buffer.set(initialBuffer, length - initialBuffer.length)

    return buffer
  }

  export function fixedLengthBufferToHex(buf: BufferLike): string {
    let hex = bufferToHex(buf.slice())
    while (hex[0] == "0" && hex[1] == "0") { // Remove leading zeros
      hex = hex.slice(2)
    }

    return hex
  }

  export function stringToBuffer(str: string, simple = false): Uint8Array {
    const stringArr = simple ? new Uint8Array(str.length) : new Uint16Array(str.length)
    for (let i=0, strLen=str.length; i<strLen; i++) {
      stringArr[i] = str.charCodeAt(i)
    }

    return new Uint8Array(stringArr.buffer)
  }

  export function bufferToString(buf: Uint8Array, simple = false): string {
    const stringArr = simple ? new Uint8Array(buf.slice().buffer) : new Uint16Array(buf.slice().buffer)

    let string = ""
    for (let i = 0; i < stringArr.length; i++) {
      string += String.fromCharCode(stringArr[i])
    }

    return string
  }

  export function hexToBuffer(hex: string): Uint8Array {
    return new Uint8Array(new BN(hex, "hex").toArray())
  }

  export function bufferToHex(buf: BufferLike): string {
    let hex = ""
    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i]
      if (byte < 0x10) { hex += "0" }
      hex += byte.toString(16)
    }

    return hex
  }

  class BaseNumeralData {
    readonly encodeDigits: string
    readonly decodeDigits: Record<string, number>

    constructor(encodeDigits: string, caseInsensitiveDecode = true) {
      this.encodeDigits = encodeDigits
      this.decodeDigits = { }

      const allLowerCase = caseInsensitiveDecode && encodeDigits.toLowerCase() === encodeDigits
      const allUpperCase = caseInsensitiveDecode && encodeDigits.toUpperCase() === encodeDigits

      for (let i = 0; i < encodeDigits.length; i++) {
        const digit = encodeDigits[i]
        this.decodeDigits[digit] = i

        if (allLowerCase) {
          this.decodeDigits[digit.toUpperCase()] = i
        } else if (allUpperCase) {
          this.decodeDigits[digit.toLowerCase()] = i
        }
      }
    }
  }
  
  class BaseConverter {
    private readonly encodeDigits: string
    private readonly decodeDigits: Record<string, number>
  
    private readonly base: number
    private readonly bigBase: BN
  
    constructor(data: BaseNumeralData) {
      this.encodeDigits = data.encodeDigits
      this.decodeDigits = data.decodeDigits
  
      this.base = data.encodeDigits.length
      this.bigBase = new BN(data.encodeDigits.length)
    }
  
    encode(num: BufferLike | BN): string {
      let outStr = ""
  
      const bn = num instanceof BN ? num.clone() : new BN(num)
      while (bn.gten(this.base)) {
        const remainder = bn.modn(this.base)
        bn.idivn(this.base)
  
        outStr = this.encodeDigits[remainder] + outStr
      }

      outStr = this.encodeDigits[bn.toNumber()] + outStr
      
      return outStr
    }
  
    decodeBuffer(str: string, length?: number): Uint8Array {
      return new Uint8Array(this.decodeNumber(str).toArray(undefined, length))
    }

    decodeNumber(str: string): BN {
      if (!this.isEncodedString(str)) {
        throw new Error("String is not a valid encoding")
      }

      const outNum = new BN(0)
  
      for (let i = 0; i < str.length; i++) {
        const digit = str[i];
        const place = this.bigBase.pow(new BN(str.length - i - 1))
  
        const val = this.decodeDigits[digit]
  
        outNum.iadd(place.muln(val))
      }

      return outNum
    }

    isEncodedString(str: string): boolean {
      for (let i = 0; i < str.length; i++) {
        const char = str[i]
        
        if (this.decodeDigits[char] === undefined) { return false }
      }

      return true
    }

    normalize(str: string): string {
      let normalized = ""
      for (let i = 0; i < str.length; i++) {
        const char = str[i]
        normalized += this.encodeDigits[this.decodeDigits[char]]
      }

      return normalized
    }
  }

  const base58Data = new BaseNumeralData("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
  base58Data.decodeDigits["0"] = base58Data.decodeDigits["O"] = base58Data.decodeDigits["o"]
  base58Data.decodeDigits["I"] = base58Data.decodeDigits["l"] = base58Data.decodeDigits["1"]
  export const Base58 = new BaseConverter(base58Data)
}

export namespace Buffer {
  export function concat(...buffers: (BufferLike)[]): Uint8Array {
    let totalLength = 0
    for (let i = 0; i < buffers.length; i++) {
      totalLength += buffers[i].length
    }
  
    const returnBuffer = new Uint8Array(totalLength)
    let currentLength = 0
    for (let i = 0; i < buffers.length; i++) {
      const buffer = buffers[i]
      returnBuffer.set(buffer, currentLength)
      currentLength += buffer.length
    }
  
    return returnBuffer
  }

  export function pad(buffer: BufferLike, padLength: number): Uint8Array {
    const returnBuffer = new Uint8Array(padLength)
    returnBuffer.set(buffer, padLength - buffer.length)
  
    return returnBuffer
  }

  export function unpad(buffer: BufferLike): Uint8Array {
    let startIndex = 0
    while (buffer[startIndex] === 0) {
      startIndex += 1
    }
  
    if (buffer instanceof Uint8Array) {
      return buffer.slice(startIndex)
    } else {
      return new Uint8Array(buffer.slice(startIndex))
    }
  }

  export function equal(...buffers: BufferLike[]): boolean {
    const length = buffers[0].length
    for (let i = 1; i < buffers.length; i++) {
      if (buffers[i].length !== length) { return false }
    }

    for (let i = 0; i < length; i++) {
      const value = buffers[0][i]
      for (let j = 1; j < buffers.length; j++) {
        if (buffers[j][i] !== value) { return false }
      }
    }

    return true
  }
}

type BufferLike = Uint8Array | number[]

export type DeepReadonly<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
}
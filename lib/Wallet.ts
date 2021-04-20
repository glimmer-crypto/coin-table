import type CoinTable from "./CoinTable"
import type Node from "./Node"
import { Convert, deepClone, Buffer, BN } from "./utils"
import Key from "./Key"
import { rand } from "elliptic"

class Wallet {
  readonly public: Key.Public
  readonly private: Key.Private
  node: Node

  constructor(privateKey: string | Key.Private, publicAddress?: string | Key.Public) {
    if (typeof privateKey === "string") {
      this.private = new Key.Private(privateKey)
    } else {
      this.private = privateKey
    }

    this.public = this.private.getPublic()
    
    if (typeof publicAddress === "string") {
      if (publicAddress !== this.public.address) {
        throw new Error("Public address incompatible with the private key")
      }
    } else if (publicAddress) {
      if (publicAddress.address !== this.public.address) {
        throw new Error("Public address incompatible with the private key")
      }
    }
  }

  signBalance(balance: CoinTable.Balance): CoinTable.SignedBalance {
    const balanceCopy = deepClone(balance) as CoinTable.SignedBalance

    const balanceBuf = Buffer.concat(
      Convert.int64ToBuffer(balance.amount),
      Convert.int64ToBuffer(balance.timestamp),
    )

    const signature = this.private.sign(balanceBuf)
    balanceCopy.signature = Convert.Base58.encode(signature)

    return balanceCopy
  }

  static verifyBalance(balance: CoinTable.SignedBalance, publicKey: Key.Public | string): boolean {
    const key = new Key.Public(publicKey)
    const balanceBuf = Buffer.concat(
      Convert.int64ToBuffer(balance.amount),
      Convert.int64ToBuffer(balance.timestamp),
    )
    return key.verify(balanceBuf, balance.signature)
  }

  createTransaction(amount: number, reciever: Key.Public | string): CoinTable.PendingTransaction {
    if (!this.node.table) { throw new Error("Missing current table") }

    const recieverKey = new Key.Public(reciever)
    if (recieverKey.address === this.public.address) { throw new Error("Cannot create a transaction with yourself") }
    
    const currentBalance = this.node.table.balances[this.public.address]
    const currentAmount = currentBalance?.amount ?? 0

    if (amount == 0) { throw new TypeError("Transaction must have a non-zero amount") }
    if (amount % 1 !== 0) { throw new TypeError("Transaction must have an integer amount") }

    if (amount > currentAmount) { throw new RangeError("Insufficient balance") }

    const timestamp = Date.now()

    const newBalance = {
      amount: currentAmount - amount,
      timestamp
    }
    const signature = this.signBalance(newBalance).signature

    const transactionBuf = Buffer.concat(
      Convert.int64ToBuffer(amount),
      Convert.int64ToBuffer(timestamp),
      Convert.Base58.decodeBuffer(recieverKey.address)
    )

    const transaction: CoinTable.PendingTransaction = {
      amount, timestamp,

      sender: this.public.address,
      reciever: recieverKey.address,
      
      senderSignature: signature,
      senderTransactionSignature: Convert.Base58.encode(this.private.sign(transactionBuf))
    }

    return transaction
  }

  signTransaction(transaction: CoinTable.PendingTransaction): CoinTable.SignedTransaction {
    if (!this.node?.table) { throw new Error("Missing current table") }
    if (transaction.reciever !== this.public.address) { throw new Error("Cannot sign transaction, not the recipient") }
    if (transaction.timestamp > Date.now()) { throw new Error("Cannot sign transaction from the future") }

    transaction = deepClone(transaction)

    const senderBalance = this.node.table.balances[transaction.sender]
    if (!senderBalance || senderBalance.amount < transaction.amount) { throw new Error("Transaction sender does not have enough funds") }

    const currentBalance = this.node.table.balances[this.public.address]
    const currentAmount = currentBalance?.amount ?? 0
    const lastTransactionTimestamp = currentBalance?.timestamp ?? 0
    
    if (transaction.timestamp <= lastTransactionTimestamp || transaction.timestamp <= senderBalance.timestamp) { throw new Error("Invalid transaction timestamp") }

    const amount = transaction.amount
    if (amount % 1 !== 0 || amount < 1) { throw new Error("Invalid transaction amount") }

    const transactionBuf = Buffer.concat(
      Convert.int64ToBuffer(amount),
      Convert.int64ToBuffer(transaction.timestamp),
      Convert.Base58.decodeBuffer(transaction.reciever)
    )
    const verified = new Key.Public(transaction.sender).verify(transactionBuf, transaction.senderTransactionSignature)
    if (!verified) { throw new Error("Unable to verify transaction") }

    const newBalance = {
      amount: currentAmount + amount,
      timestamp: transaction.timestamp
    }

    transaction.recieverSignature = this.signBalance(newBalance).signature
    return transaction as CoinTable.SignedTransaction
  }

  static verifyConfirmationTransaction(transaction: CoinTable.ConfirmationTransaction): boolean {
    const transactionBuf = Buffer.concat(
      Convert.int64ToBuffer(transaction.amount),
      Convert.int64ToBuffer(transaction.timestamp),
      Convert.Base58.decodeBuffer(transaction.reciever)
    )

    try {
      return new Key.Public(transaction.sender).verify(transactionBuf, transaction.senderTransactionSignature)
    } catch (err) {
      console.error(err)
      return false
    }
  }

  verifyTransaction(transaction: CoinTable.SignedTransaction): boolean {
    if (!this.node.table) { throw new Error("Missing current table") }
    if (transaction.amount % 1 !== 0) { return false }

    const balances = this.node.table.balances as CoinTable.Balances
    transaction.sender = Convert.Base58.normalize(transaction.sender)
    transaction.reciever = Convert.Base58.normalize(transaction.reciever)

    const senderBalance = deepClone(balances[transaction.sender])
    if (!senderBalance) { return false }
    if (senderBalance.timestamp >= transaction.timestamp) { return false }
    if (senderBalance.amount < transaction.amount) { return false }
    senderBalance.amount -= transaction.amount
    senderBalance.timestamp = transaction.timestamp
    senderBalance.signature = transaction.senderSignature

    if (!Wallet.verifyBalance(senderBalance, transaction.sender)) { return false }

    let recieverBalance = deepClone(balances[transaction.reciever])
    if (recieverBalance) {
      if (recieverBalance.timestamp >= transaction.timestamp) { return false }
      recieverBalance.amount += transaction.amount
      recieverBalance.timestamp = transaction.timestamp
      recieverBalance.signature = transaction.recieverSignature
    } else {
      recieverBalance = {
        amount: transaction.amount,
        timestamp: transaction.timestamp,
        signature: transaction.recieverSignature
      }
    }

    if (!Wallet.verifyBalance(recieverBalance, transaction.reciever)) { return false }

    return true
  }

  signMessage(buf: Uint8Array): Uint8Array {
    const signature = this.private.sign(buf, true)

    const concatBuffer = Buffer.concat(signature, buf)
    return concatBuffer
  }

  static verifyMessage(buf: Uint8Array, from: Key.Public | string): { verified: boolean, originalMessage: Uint8Array } {
    const publicKey = new Key.Public(from)

    const signature = buf.slice(0, Key.SIG_LENGTH)
    const originalMessage = buf.slice(Key.SIG_LENGTH)

    const verified = publicKey.verify(originalMessage, signature)

    return { verified, originalMessage }
  }

  static generate(): Wallet {
    return new Wallet(Key.Private.generate())
  }

  isValid(): boolean {
    const testMessage = "test " + Math.random().toString()

    const signature = this.private.sign(testMessage)
    return this.public.verify(testMessage, signature)
  }

  static importJSON(json: Wallet.JSONObject | string, password?: string): Wallet
  static importJSON(json: Wallet.JSONObject | string, password: string, progressObj: { progress?: number, stop?: boolean }): Promise<Wallet | null>
  static importJSON(json: Wallet.JSONObject | string, password?: string, progressObj?: { progress?: number, stop?: boolean }): Wallet | Promise<Wallet | null> {
    let jsonObj = json as Wallet.JSONObject
    if (typeof json === "string") { jsonObj = JSON.parse(json) }

    if (jsonObj.salt) {
      if (!password) { throw new Error("Missing password") }

      const hashIterations = typeof jsonObj.iterations === "number" ? jsonObj.iterations : defaultPasswordHashIterations

      if (progressObj) {
        return Key.Private.importEncrypted(jsonObj.privateKey, password, jsonObj.salt, hashIterations, progressObj).then(privateKey => {
          if (!privateKey) { return null }

          return new Wallet(privateKey, jsonObj.publicAddress)
        })
      }

      const privateKey = Key.Private.importEncrypted(jsonObj.privateKey, password, jsonObj.salt, hashIterations)
      return new Wallet(privateKey, jsonObj.publicAddress)
    }

    const wallet = new Wallet(jsonObj.privateKey, jsonObj.publicAddress)
    return wallet
  }

  exportJSON(password?: string, iterations?: number): Wallet.JSONObject
  exportJSON(password: string, iterations: number | undefined | null, progressObj: { progress?: number, stop?: boolean }): Promise<Wallet.JSONObject | null>
  exportJSON(password?: string, iterations?: number, progressObj?: { progress?: number, stop?: boolean }): Wallet.JSONObject | Promise<Wallet.JSONObject | null>  {
    const hashIterations = iterations ?? defaultPasswordHashIterations

    if (password) {
      const salt = Math.random().toString(36).slice(2)

      if (progressObj) {
        return this.private.exportEncrypted(password, salt, hashIterations, progressObj).then(privateKey => {
          if (!privateKey) { return null }
          
          return {
            publicAddress: this.public.address,
            privateKey: privateKey,
            salt,
            iterations: hashIterations
          }
        })
      }

      return {
        publicAddress: this.public.address,
        privateKey: this.private.exportEncrypted(password, salt, hashIterations),
        salt,
        iterations: hashIterations
      }
    }

    if (progressObj) {
      progressObj.progress = 1
      return new Promise(r => r({
        publicAddress: this.public.address,
        privateKey: this.private.toString()
      }))
    }

    return {
      publicAddress: this.public.address,
      privateKey: this.private.toString()
    }
  }

  static fromSeedPhrase(seed: string, password?: string): Wallet
  static fromSeedPhrase(seed: string, password: string, progressObj: { progress?: number, stop?: boolean }): Promise<Wallet | null>
  static fromSeedPhrase(seed: string, password = "", progressObj?: { progress?: number, stop?: boolean }): Wallet | Promise<Wallet | null> {
    const json: Wallet.JSONObject = {
      privateKey: "11111111111111111111111111111111111111111111",
      salt: "seed",
      iterations: 100_000
    }

    const fullSeed = seed + ":" + password
    if (progressObj) {
      return Wallet.importJSON(json, fullSeed, progressObj)
    } else {
      return Wallet.importJSON(json, fullSeed)
    }
  }
}

const defaultPasswordHashIterations = 15_000

namespace Wallet {
  export type JSONObject = {
    publicAddress?: string,
    privateKey: string,
    salt?: string,
    iterations?: number
  }

  export class WordList {
    readonly wordlist: string[]

    private readonly count: number
    private readonly bncount: BN

    private readonly minLength: number
    private readonly maxLength: number

    private readonly alphabet = new Set<string>()

    constructor(wordlist: string[]) {
      this.wordlist = wordlist
      this.count = wordlist.length
      this.bncount = new BN(wordlist.length)

      let minLength = Infinity
      let maxLength = 0

      wordlist.forEach(word => {
        if (word.length < minLength) {
          minLength = word.length
        }
        if (word.length > maxLength) {
          maxLength = word.length
        }

        word.split("").forEach(char => this.alphabet.add(char))
      })

      this.minLength = minLength
      this.maxLength = maxLength
    }

    generateSeedPhrase(): string {
      const randomBytes = rand(17)
  
      const bigNum = new BN(randomBytes)
      const words = []
      for (let i = 0; i < 12; i++) {
        const wordIndex = bigNum.mod(this.bncount).toNumber()
        words.push(this.wordlist[wordIndex])

        bigNum.idivn(this.count)
      }

      return words.join(" ")
    }

    normalizeSeedPhrase(seed: string): string | null {
      const normalizeSpaces = seed.trim().replace(/\s+/g, " ")

      const words = normalizeSpaces.split(" ")
      if (words.length !== 12 || words.some(word => word.length < this.minLength || word.length > this.maxLength)) {
        return null
      }

      const normalizeCase = normalizeSpaces.toLowerCase()
      if (!normalizeCase.split("").every(char => char === " " || this.alphabet.has(char))) {
        return null
      }
      
      return normalizeCase
    }
  }
}

export default Wallet
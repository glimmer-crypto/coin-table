import Wallet from "./Wallet"
import { deepClone, DeepReadonly, Convert, Buffer, hash, SortedList } from "./utils"
import Key from "./Key"

type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
}

let normalizedIdentifier: string
let normalizedIdentifierSignature: string
class CoinTable {
  static readonly identifier: string
  static readonly networkId: string

  static readonly TOTAL_COINS: number
  static readonly SUBDIVISION: number

  static readonly initialTable: CoinTable

  readonly balances: DeepReadonly<CoinTable.Balances>
  readonly coinSum: number
  readonly isValid: boolean
  readonly invalidReason?: string
  readonly digest: Uint8Array

  readonly addresses: SortedList<string>// DeepReadonly<string[]>

  constructor(balances: CoinTable.Balances) {
    if (!initializing && !initialized) { throw new Error("Not initialized, use CoinTable.initialize()") }

    let coinSum = 0

    const normalizedBalances: CoinTable.Balances = {
      burned: balances.burned
    }
    const addresses: string[] = []
    Object.keys(balances).forEach(addr => {
      coinSum  += balances[addr].amount

      if (addr === "burned") { return }

      const norm = Convert.Base58.normalize(addr)
      normalizedBalances[norm] = deepClone(balances[addr])

      addresses.push(norm)
    })

    this.addresses = new SortedList(addresses, true)

    this.balances = normalizedBalances
    this.coinSum = coinSum

    const results = this.verifyTable()
    this.isValid = results.valid
    this.invalidReason = results.reason

    this.digest = new Uint8Array(hash(this.exportBuffer()))
  }

  verifyTable(): { valid: boolean, reason?: string } {
    let balanceSum = 0
    
    const walletAddresses = this.addresses
    const balances = this.balances

    const identifyingBalance = this.balances[normalizedIdentifier]
    const hasIdentifier = (
      identifyingBalance &&
      identifyingBalance.amount === 0 &&
      identifyingBalance.timestamp === 0 &&
      identifyingBalance.signature === Convert.Base58.normalize(normalizedIdentifierSignature)
    )
    if (!hasIdentifier) {
      return {
        valid: false,
        reason: "Missing or invalid identifier"
      }
    }

    for (let i = 0; i < walletAddresses.length; i++) {
      const walletAddress = walletAddresses.list[i]
      if (walletAddress === normalizedIdentifier) { continue }

      const balance = balances[walletAddress]

      balanceSum += balance.amount

      if (!Wallet.verifyBalance(balance, walletAddress)) {
        return {
          valid: false,
          reason: "Invalid balance signature"
        }
      }
      if (balanceSum > CoinTable.TOTAL_COINS) {
        return {
          valid: false,
          reason: "Invalid coin amount"
        }
      }
      if (balance.timestamp > Date.now()) {
        return {
          valid: false,
          reason: "Bad timestamp"
        }
      }
    }

    if (balanceSum !== CoinTable.TOTAL_COINS) {
      return {
        valid: false,
        reason: "Invalid coin amount"
      }
    }

    return {
      valid: true
    }
  }

  applyTransaction(transaction: CoinTable.SignedTransaction): void {
    if (transaction.amount % 1 !== 0) { throw new CoinTable.TransactionError("Invalid transaction amount") }

    const balances = this.balances as CoinTable.Balances
    transaction.sender = Convert.Base58.normalize(transaction.sender)
    transaction.reciever = Convert.Base58.normalize(transaction.reciever)

    const senderBalance = deepClone(balances[transaction.sender] ?? zeroBalance()) as CoinTable.SignedBalance
    if (senderBalance.timestamp >= transaction.timestamp) { throw new CoinTable.TransactionError("Transaction timestamp is invalid") }
    if (senderBalance.amount < transaction.amount) { throw new CoinTable.TransactionError("Sender does not have sufficient balance") }
    senderBalance.amount -= transaction.amount
    senderBalance.timestamp = transaction.timestamp
    senderBalance.signature = transaction.senderSignature

    if (!Wallet.verifyBalance(senderBalance, transaction.sender)) { throw new CoinTable.TransactionError("Sender signature is invalid") }

    const recieverBalance = deepClone(balances[transaction.reciever] ?? zeroBalance()) as CoinTable.SignedBalance
    if (recieverBalance.timestamp >= transaction.timestamp) { throw new CoinTable.TransactionError("Transaction timestamp is invalid") }
    recieverBalance.amount += transaction.amount
    recieverBalance.timestamp = transaction.timestamp
    recieverBalance.signature = transaction.recieverSignature

    if (!Wallet.verifyBalance(recieverBalance, transaction.reciever)) { throw new CoinTable.TransactionError("Reciever signature is invalid") }

    if (!balances[transaction.reciever]) {
      this.addresses.insert(transaction.reciever)
    }
    balances[transaction.sender] = senderBalance
    balances[transaction.reciever] = recieverBalance;

    (this as Mutable<this>).digest = new Uint8Array(hash(this.exportBuffer()))
  }

  exportBuffer(): Uint8Array {
    const balances: Uint8Array[] = []

    for (let i = 0; i < this.addresses.length; i++) {
      const address = this.addresses.list[i]
      const balance = this.balances[address]

      balances.push(Buffer.concat(
        Convert.Base58.decodeBuffer(address, Key.Public.LENGTH),
        Convert.int64ToBuffer(balance.amount),
        Convert.int64ToBuffer(balance.timestamp),
        Convert.Base58.decodeBuffer(balance.signature, Key.SIG_LENGTH)
      ))
    }

    const balanceSize = Key.Public.LENGTH + 8 + 8 + Key.SIG_LENGTH
    const buffer = new Uint8Array(balances.length * balanceSize)
    balances.forEach((bal, i) => {
      buffer.set(bal, balanceSize * i)
    })

    return Buffer.concat(buffer, Convert.int64ToBuffer(this.balances.burned.amount))
  }

  static importBuffer(buffer: Uint8Array): CoinTable {
    const balances: CoinTable.Balances = {
      burned: {
        amount: 0,
        timestamp: 0,
        signature: ""
      }
    }

    let startIndex = 0

    while (startIndex < buffer.length - 8) {
      const addressArr = buffer.subarray(startIndex, startIndex += Key.Public.LENGTH)
      const amount = Convert.bufferToInt(buffer.subarray(startIndex, startIndex += 8))
      const timestamp = Convert.bufferToInt(buffer.subarray(startIndex, startIndex += 8))
      const sigArr = buffer.subarray(startIndex, startIndex += Key.SIG_LENGTH)

      const walletAddress = Convert.Base58.encode(addressArr)
      const signature = Convert.Base58.encode(sigArr)

      balances[walletAddress] = {
        amount: Number(amount),
        timestamp: Number(timestamp),
        signature
      }
    }

    if (startIndex === buffer.length - 8) {
      balances.burned.amount = Convert.bufferToInt(buffer.subarray(startIndex, startIndex + 8))
    }

    return new CoinTable(balances)
  }

  static initialize(networkId: string, totalCoins: number, subdivision: number, initialBalances: CoinTable.Balances | Omit<CoinTable.Balances, "burned">): void {
    try {
      const splitId = networkId.split(":")
      if (splitId.length !== 2 || !splitId[0] || !Convert.Base58.isEncodedString(splitId[0]) || !splitId[1] || !Convert.Base58.isEncodedString(splitId[1])) {
        throw new TypeError("Invalid network ID")
      }
      const identifier = splitId[0]
      const identifierSignature = splitId[1]

      if (totalCoins % 1 !== 0 || totalCoins <= 0) {
        throw new TypeError("Total coins must be a positive integer")
      }

      if (subdivision % 1 !== 0 || subdivision <= 0) {
        throw new TypeError("Subdivision must be a positive integer")
      }

      const balances = deepClone(initialBalances)
      if (!balances.burned) {
        balances.burned = { amount: 0, timestamp: 0, signature: "" }
      }
      balances[identifier] = { amount: 0, timestamp: 0, signature: identifierSignature }

      normalizedIdentifier = Convert.Base58.normalize(identifier)
      normalizedIdentifierSignature = Convert.Base58.normalize(identifierSignature)

      initializing = true

      const statics: Mutable<typeof CoinTable> = CoinTable

      statics.identifier = identifier
      statics.networkId = networkId
      statics.TOTAL_COINS = totalCoins
      statics.SUBDIVISION = subdivision
      statics.initialTable = new CoinTable(balances as CoinTable.Balances)

      if (!CoinTable.initialTable.isValid) {
        throw new TypeError("Initial table is invalid (" + CoinTable.initialTable.invalidReason + ")")
      }

      initialized = true
      initializing = false
    } catch (err) {
      initializing = false
      throw err
    }
  }
}
let initializing = false
let initialized = false

function zeroBalance(): CoinTable.Balance {
  return { amount: 0, timestamp: 0 }
}

namespace CoinTable {
  export interface Balances {
    [walletAddress: string]: SignedBalance
    burned: {
      amount: number,
      timestamp: 0,
      signature: ""
    }
  }
  
  export interface Balance {
    amount: number
    timestamp: number
  }

  export interface SignedBalance extends Balance {
    signature: string
  }

  export interface Transaction {
    sender: string
    reciever: string
    amount: number
    timestamp: number
  }

  export interface ConfirmationTransaction extends Transaction {
    senderTransactionSignature: string
  }

  export interface PendingTransaction extends ConfirmationTransaction {
    senderSignature: string,
    recieverSignature?: string
  }

  export interface SignedTransaction extends PendingTransaction {
    recieverSignature: string
  }

  export class TransactionError extends Error { }
}

export default CoinTable
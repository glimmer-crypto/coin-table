import { Wallet, CoinTable, Node, Network, Key, utils } from "../lib"
const { Convert, Buffer } = utils

/*
const totalCoins = 100

const wallet = Wallet.generate()

const balances: CoinTable.Balances = {}
balances[wallet.public.address] = wallet.signBalance({
  amount: 100,
  timestamp: Date.now()
})

console.log(wallet.public.address)

CoinTable.initialize(
  "cointable:test",
  totalCoins,
  1,
  balances
)

console.log(CoinTable.initialTable)
console.log(CoinTable.initialTable)

const network = new Network.Local(wallet)
const node = new Node(wallet, network)

const wallet2 = Wallet.generate()
const network2 = new Network.Local(wallet2)
const node2 = new Node(wallet2, network2)

network.connect(node2)
network2.connect(node)

node.sendTransaction(5, wallet2.public.address)
node.getTable().then(console.log)
*/

CoinTable.initialize(
  "glimmer:main",
  500000000000000, // 500,000,000,000,000
  10000000, // 10,000,000
  {
    "2TFzfHYjxkZSurwmbxuAEd6RpqoKvmJGFyL5W46j3xTXXV": {amount: 500000000000000, timestamp: 1618175060980, signature: "gGjvvjSNbD8RDiyHf8QbQVdj8WbyTiTGyvJPJ1LAw3pjU9Ts7EweyBoYwajQRDPCNhqGgqc9X9nJ5mL9wLcR8nyWs2P4vb"}
  }
)

const wallet = new Wallet("***", "2jmBMjcxTVvpZ5m23iN3NwAFvSPCFiQSr9jnPZZrKPV5Ur")
const client = new Network.Client(wallet)
const node = new Node(wallet, client)

const wallet2 = new Wallet("***", "2ocJ1Eh1MgcnLaNqgimQapDLPjzk9CExw6du6JxbsJYKdJ")
const addresses = ["2tYgHwwWV8msP8D73y3wRUh8fqGJ3CpDxZWBBRBtYK9WWP"/*, "3HzSquXCpBbMWKffV288Cc1TcgqfgdpaAQcDw2etTrKezf"*/]

function sendConflictingTransactions() {
  const transaction = wallet.createTransaction(1, wallet2.public)

  // @ts-ignore
  wallet2.node = {
    table: node.table
  }
  const signed = wallet2.signTransaction(transaction)
  client.shareTransaction(signed)
  
  addresses.forEach(address => {
    const transaction = wallet.createTransaction(1, address)
    const connection = client.bestConnection(address)

    console.log(transaction)

    const transactionBuffer = Buffer.concat(
      Convert.Base58.decodeBuffer(transaction.sender, Key.Public.LENGTH),
      Convert.Base58.decodeBuffer(transaction.senderSignature ?? "1", Key.SIG_LENGTH),
      Convert.Base58.decodeBuffer(transaction.senderTransactionSignature, Key.SIG_LENGTH),
      Convert.Base58.decodeBuffer(transaction.reciever, Key.Public.LENGTH),
      Convert.int64ToBuffer(transaction.amount),
      Convert.int64ToBuffer(transaction.timestamp)
    )
    
    connection.sendAndWaitForResponse("pending_transaction", transactionBuffer, "pending_transaction_signature", true).then(response => {
      console.log("response", address.slice(0, 8) , response)
    })
  })
}

let hasTable = false
node.on("newtable", () => {
  hasTable = true
  console.log("newtable", connected)

  if (connected && hasTable) {
    sendConflictingTransactions()
  }
})

let connected = false
client.on("connection", (connection) => {
  connected = addresses.every(addr => client.bestConnection(addr))
  console.log("connection", connection, connected, hasTable)

  if (connected && hasTable) {
    sendConflictingTransactions()
  }
})

client.connectToWebSocket("localhost:8080")
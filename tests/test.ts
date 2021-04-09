import { Wallet, CoinTable, Node, Network } from "../lib"

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

const network = new Network.Local(wallet)
const node = new Node(wallet, network)

const wallet2 = Wallet.generate()
const network2 = new Network.Local(wallet2)
const node2 = new Node(wallet2, network2)

network.connect(node2)
network2.connect(node)

node.sendTransaction(5, wallet2.public.address)
node.getTable().then(console.log)
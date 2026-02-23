import { useState } from 'react'
import { createAndFundAccount } from './stellar'

function App() {
  const [accounts, setAccounts] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSetup() {
    setLoading(true)
    try {
      const sender = await createAndFundAccount();
      const receiver = await createAndFundAccount();
      setAccounts({ sender, receiver });
    }
    catch (error) {
      console.error(error)
    }
    setLoading(false)

  }
  return (
  <>
      <div>
        <h1>Stellar Path Payment Demo</h1>
        <button onClick={handleSetup} disabled={loading}>
          {loading ? 'Creating accounts...' : 'Setup Testnet Accounts'}
        </button>
        {accounts && (
          <div>
            <p><b>Sender:</b> {accounts.sender.publicKey()}</p>
            <p><b>Receiver:</b> {accounts.receiver.publicKey()}</p>
          </div>
        )}
      </div>
    </>
  )
}

export default App

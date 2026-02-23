import * as StellarSdk from "@stellar/stellar-sdk";

const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");

//create new random keypair and fund it
export async function createAndFundAccount() {


    const keypair = StellarSdk.Keypair.random();

    const response = await fetch(
        `https://friendbot.stellar.org?addr=${keypair.publicKey()}`
      );

      if (!response.ok) throw new Error('Friendbot funding failed');

      console.log('Public Key:', keypair.publicKey());
      console.log('Secret Key:', keypair.secret());
      console.log("keypair->", keypair)
      
      return keypair;
}
//run test
createAndFundAccount()
export { server, StellarSdk };

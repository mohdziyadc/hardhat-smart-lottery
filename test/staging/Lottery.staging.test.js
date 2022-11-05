const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

developmentChains.includes(network.name) ?
    describe.skip :
    describe("Lottery Unit Tests", function () {
        let lottery, deployer, lotteryEntranceFee

        beforeEach(async () => {
            // deployer = await getNamedAccounts() // if done like this it throws invalid signer or provider error
            deployer = (await getNamedAccounts()).deployer
            lottery = await ethers.getContract("Lottery", deployer)
            lotteryEntranceFee = await lottery.getEntranceFee()

        })

        describe("fulfillRandomWords", () => {
            it("works with live Chainlink Keepers and Chainlink VRF, selects a winner", async () => {
                const startingTimeStamp = await lottery.getLastTimeStamp()
                const accounts = await ethers.getSigners()

                await new Promise(async (resolve, reject) => {
                    //before calling the enterLottery(), we need to setup the listener
                    //just in case the blockchain is really fast
                    lottery.once("WinnerPicked", async () => {
                        console.log("WinnerPick event called")
                        try {
                            const recentWinner = await lottery.getRecentWinner()
                            const winnerEndingBalance = await accounts[0].getBalance()
                            const lotteryState = await lottery.getLotteryState()
                            const endingTimeStamp = await lottery.getLastTimeStamp()
                            //add our asserts here
                            await expect(lottery.getPlayer(0)).to.be.reverted //if our array is reset
                            assert.equal(recentWinner.toString(), accounts[0].address) //if the deployer wins
                            assert.equal(
                                winnerEndingBalance.toString(),
                                winnerStartingBalance.add(lotteryEntranceFee).toString()
                            )
                            assert.equal(lotteryState.toString(), "0")
                            assert(endingTimeStamp > startingTimeStamp)
                            resolve()
                        } catch (e) {
                            console.log(e)
                            reject(e)
                        }
                    })

                    console.log("Entering Raffle...")
                    const tx = await lottery.enterLottery({ value: lotteryEntranceFee })
                    // await tx.wait(1)
                    // console.log("Ok, time to wait...")
                    // const winnerStartingBalance = await accounts[0].getBalance()
                })
            })
        })
    })




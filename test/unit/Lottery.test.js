const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name) ?
    describe.skip :
    describe("Lottery Unit Tests", function () {
        let lottery, vrfCoordinatorV2Mock, deployer
        let lotteryEntranceFee, interval
        const chainId = network.config.chainId

        beforeEach(async () => {
            // deployer = await getNamedAccounts() // if done like this it throws invalid signer or provider error
            deployer = (await getNamedAccounts()).deployer
            await deployments.fixture(["all"])
            lottery = await ethers.getContract("Lottery", deployer)
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
            lotteryEntranceFee = await lottery.getEntranceFee()
            interval = await lottery.getInterval()

        })

        describe("constructor", () => {
            it("Intializes the lottery correctly", async () => {
                const lotteryState = await lottery.getLotteryState()
                // console.log(`LotteryState : ${lotteryState}`)
                assert.equal(lotteryState, "0")
                assert.equal(interval.toString(), networkConfig[chainId]["interval"])
            })
        })

        describe("enterLottery", () => {
            it("reverts if there isn't enough ETH", async () => {
                await expect(lottery.enterLottery()).to.be.revertedWith("Lottery__NotEnoughETH")
            })

            it("records the new player", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                const player = await lottery.getPlayer(0)
                assert.equal(player, deployer)
            })
            //Testing if an event emits
            it("emits event on enter", async () => {
                await expect(lottery.enterLottery({ value: lotteryEntranceFee }))
                    .to.emit(lottery, "LotteryEnter")
            })

            it("doesn't allow the player to enter if it's calculating", async () => {
                //fund the lottery contract
                await lottery.enterLottery({ value: lotteryEntranceFee })
                //Right now our contract is in an open state
                //We need to make it calculating by calling the performUpkeep()
                //Then we can expect to revert with an error
                //We are actually meeting our interval time.
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", []) //Mining an extra block
                //We are acting as a Mock Chainlink Keeper
                await lottery.performUpkeep([])

                await expect(lottery.enterLottery({ value: lotteryEntranceFee }))
                    .to.be.revertedWith("Lottery__NotOpen")

            })
        })

        describe("checkUpkeep", () => {
            it("returns false if people haven't sent any ETH", async () => {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])

                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                //callStatic simulates sending the transaction and doesn't actually sends it
                //bcs checkUpkeep() is a public function and not a public view function.
                assert.equal(upkeepNeeded, false)
            })

            it("returns false if lottery isn't open", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                await lottery.performUpkeep([]) //changing lottery state to CALCULATING

                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                const lotteryState = await lottery.getLotteryState()
                assert.equal(lotteryState.toString(), "1")
                assert.equal(upkeepNeeded, false)
            })

            it("returns false if enough time hasn't passed", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                assert(upkeepNeeded)
            })

            it("returns true if enough eth, time has passed, has players and is open", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x")
                assert(upkeepNeeded)
            })

        })

        describe("performUpkeep", () => {
            it("can only run if checkUpkeep is true", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const tx = await lottery.performUpkeep([])
                // console.log(tx)
                assert(tx)
            })

            it("reverts when checkUpkeep is false", async () => {
                await expect(lottery.performUpkeep([])).to.be.revertedWith(
                    "Lottery__UpkeepNotNeeded"
                )
            })
            it("changes the lottery state to calculating, emits an event and calls the vrfCoordinator", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const transaction = await lottery.performUpkeep([])
                const lotteryState = await lottery.getLotteryState()
                assert.equal(lotteryState, "1")
                const transactionReceipt = await transaction.wait(1)
                const requestId = transactionReceipt.events[1].args.requestId
                // console.log(requestId.toNumber())
                assert(requestId.toNumber() > 0)
                //The requestId emitting from RequestedLotteryWinner() event 
                //is the second event emitted hence events[1] is used. The first event
                // is triggered in the VRFCoordinatorV2Mock.sol

            })

        })

        describe("fullfillRandomWords", () => {
            beforeEach(async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])

            })
            it("can only be called only after performUpkeep", async () => {
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address))
                    .to.be.revertedWith("nonexistent request")

                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address))
                    .to.be.revertedWith("nonexistent request")

            })

            it("picks a winner, resets the lottery and sends money", async () => {
                const additionalEntrants = 3
                const startingAcntIndex = 1 //since deployer's gonna be the 0th index
                const accounts = await ethers.getSigners()

                for (let i = startingAcntIndex; i < startingAcntIndex + additionalEntrants; i++) {
                    const connectedAccount = lottery.connect(accounts[i]) //connecting the account
                    await connectedAccount.enterLottery({ value: lotteryEntranceFee })
                }
                const startingTimeStamp = await lottery.getLastTimeStamp()

                await new Promise(async (resolve, reject) => {

                    //listener for the event
                    lottery.once("WinnerPicked", async () => {
                        console.log("Event Triggered")

                        try {
                            const recentWinner = await lottery.getRecentWinner()
                            const lotteryState = await lottery.getLotteryState()
                            const numPlayers = await lottery.getPlayersList()
                            const endingTimeStamp = await lottery.getLastTimeStamp()
                            const winnerEndingBalance = await accounts[1].getBalance()
                            assert.equal(numPlayers.toString(), "0")
                            assert.equal(lotteryState.toString(), "0")
                            assert(endingTimeStamp > startingTimeStamp)
                            console.log(recentWinner)
                            console.log(accounts[2].address)
                            console.log(accounts[0].address)
                            console.log(accounts[1].address)
                            console.log(accounts[3].address)
                            console.log(`Winner Ending Balance: ${winnerEndingBalance.toString()}`)


                            // const amountInLottery = (additionalEntrants * lotteryEntranceFee)

                            //deployer amount + additional entrants amount
                            assert.equal(
                                winnerEndingBalance.toString(),
                                winnerStartingBalance.add(lotteryEntranceFee
                                    .mul(additionalEntrants)
                                    .add(lotteryEntranceFee)).toString()
                            )
                            //By running this, we have seen that account 1 is the winner in this test
                            resolve()
                        } catch (e) {
                            reject(e)
                        }

                    })
                    const tx = await lottery.performUpkeep([])
                    const txReciept = await tx.wait(1)
                    const winnerStartingBalance = await accounts[1].getBalance() //We know account 1 wins
                    await vrfCoordinatorV2Mock.fulfillRandomWords(
                        txReciept.events[1].args.requestId,
                        lottery.address
                    )
                    console.log(`Winner Starting Balance: ${winnerStartingBalance.toString()}`)

                })
            })
        })

    })
const { network, ethers } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config.js")


const BASE_FEE = ethers.utils.parseEther("0.25") // It costs 0.25 LINK per request
const GAS_PRICE_LINK = 1e9
module.exports = async function ({ getNamedAccounts, deployments }) {

    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()


    if (developmentChains.includes(network.name)) {
        log("Local Network Detected ............")
        //Deploy a mock VRFCoordinatorV2 contract
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: [BASE_FEE, GAS_PRICE_LINK]
        })
        log("Mocks Deployed!")
        log("-------------------------------------------------------------------------")

    }

}

module.exports.tags = ["all", "mocks"]
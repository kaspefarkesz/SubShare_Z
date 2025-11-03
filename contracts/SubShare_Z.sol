pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SubShare_Z is ZamaEthereumConfig {
    
    struct SubscriptionGroup {
        string groupId;                    
        euint32 encryptedShareAmount;        
        uint256 publicTotalAmount;          
        uint256 publicMemberCount;          
        string description;            
        address creator;               
        uint256 creationTime;             
        uint32 decryptedShareAmount; 
        bool isVerified; 
    }
    
    mapping(string => SubscriptionGroup) public subscriptionGroups;
    string[] public groupIds;
    
    event GroupCreated(string indexed groupId, address indexed creator);
    event DecryptionVerified(string indexed groupId, uint32 decryptedValue);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createSubscriptionGroup(
        string calldata groupId,
        string calldata name,
        externalEuint32 encryptedShareAmount,
        bytes calldata inputProof,
        uint256 publicTotalAmount,
        uint256 publicMemberCount,
        string calldata description
    ) external {
        require(bytes(subscriptionGroups[groupId].description).length == 0, "Group already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedShareAmount, inputProof)), "Invalid encrypted input");
        
        subscriptionGroups[groupId] = SubscriptionGroup({
            groupId: name,
            encryptedShareAmount: FHE.fromExternal(encryptedShareAmount, inputProof),
            publicTotalAmount: publicTotalAmount,
            publicMemberCount: publicMemberCount,
            description: description,
            creator: msg.sender,
            creationTime: block.timestamp,
            decryptedShareAmount: 0,
            isVerified: false
        });
        
        FHE.allowThis(subscriptionGroups[groupId].encryptedShareAmount);
        FHE.makePubliclyDecryptable(subscriptionGroups[groupId].encryptedShareAmount);
        
        groupIds.push(groupId);
        emit GroupCreated(groupId, msg.sender);
    }
    
    function verifyShareAmount(
        string calldata groupId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(subscriptionGroups[groupId].description).length > 0, "Group does not exist");
        require(!subscriptionGroups[groupId].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(subscriptionGroups[groupId].encryptedShareAmount);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        subscriptionGroups[groupId].decryptedShareAmount = decodedValue;
        subscriptionGroups[groupId].isVerified = true;
        
        emit DecryptionVerified(groupId, decodedValue);
    }
    
    function getEncryptedShareAmount(string calldata groupId) external view returns (euint32) {
        require(bytes(subscriptionGroups[groupId].description).length > 0, "Group does not exist");
        return subscriptionGroups[groupId].encryptedShareAmount;
    }
    
    function getSubscriptionGroup(string calldata groupId) external view returns (
        string memory name,
        uint256 publicTotalAmount,
        uint256 publicMemberCount,
        string memory description,
        address creator,
        uint256 creationTime,
        bool isVerified,
        uint32 decryptedShareAmount
    ) {
        require(bytes(subscriptionGroups[groupId].description).length > 0, "Group does not exist");
        SubscriptionGroup storage group = subscriptionGroups[groupId];
        
        return (
            group.groupId,
            group.publicTotalAmount,
            group.publicMemberCount,
            group.description,
            group.creator,
            group.creationTime,
            group.isVerified,
            group.decryptedShareAmount
        );
    }
    
    function getAllGroupIds() external view returns (string[] memory) {
        return groupIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


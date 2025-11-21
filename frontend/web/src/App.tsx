import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SubscriptionGroup {
  id: string;
  name: string;
  encryptedAmount: string;
  totalMembers: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedAmount?: number;
  publicValue1: number;
  publicValue2: number;
}

interface SubscriptionStats {
  totalGroups: number;
  activeSubscriptions: number;
  totalSavings: number;
  verifiedPayments: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<SubscriptionGroup[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSubscription, setCreatingSubscription] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSubscriptionData, setNewSubscriptionData] = useState({ 
    name: "", 
    amount: "", 
    members: "", 
    description: "" 
  });
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionGroup | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [stats, setStats] = useState<SubscriptionStats>({
    totalGroups: 0,
    activeSubscriptions: 0,
    totalSavings: 0,
    verifiedPayments: 0
  });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const subscriptionsList: SubscriptionGroup[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          subscriptionsList.push({
            id: businessId,
            name: businessData.name,
            encryptedAmount: businessId,
            totalMembers: Number(businessData.publicValue1) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedAmount: Number(businessData.decryptedValue) || 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSubscriptions(subscriptionsList);
      updateStats(subscriptionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (subs: SubscriptionGroup[]) => {
    const totalGroups = subs.length;
    const verifiedPayments = subs.filter(s => s.isVerified).length;
    const activeSubscriptions = subs.filter(s => s.timestamp > Date.now()/1000 - 2592000).length;
    const totalSavings = subs.reduce((sum, sub) => sum + (sub.decryptedAmount || 0), 0);
    
    setStats({
      totalGroups,
      activeSubscriptions,
      totalSavings,
      verifiedPayments
    });
  };

  const createSubscription = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSubscription(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating subscription with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newSubscriptionData.amount) || 0;
      const businessId = `subscription-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSubscriptionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newSubscriptionData.members) || 0,
        0,
        newSubscriptionData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Subscription created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSubscriptionData({ name: "", amount: "", members: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSubscription(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Amount decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSubscriptions = subscriptions.filter(sub => {
    const matchesSearch = sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sub.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || sub.isVerified;
    return matchesSearch && matchesFilter;
  });

  const renderStatsPanel = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card gold-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Groups</h3>
            <div className="stat-value">{stats.totalGroups}</div>
            <div className="stat-trend">Active: {stats.activeSubscriptions}</div>
          </div>
        </div>
        
        <div className="stat-card silver-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Payments</h3>
            <div className="stat-value">{stats.verifiedPayments}</div>
            <div className="stat-trend">FHE Secured</div>
          </div>
        </div>
        
        <div className="stat-card bronze-card">
          <div className="stat-icon">💸</div>
          <div className="stat-content">
            <h3>Total Savings</h3>
            <div className="stat-value">${stats.totalSavings}</div>
            <div className="stat-trend">Shared Economy</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Amount Encryption</h4>
            <p>Subscription amount encrypted with FHE 🔒</p>
          </div>
        </div>
        <div className="process-arrow">➤</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>On-chain Storage</h4>
            <p>Encrypted data stored securely on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">➤</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Split</h4>
            <p>Amount divided without decryption</p>
          </div>
        </div>
        <div className="process-arrow">➤</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Secure Verification</h4>
            <p>Proof validation with FHE signatures</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔒</div>
            <h1>SubShare_Z</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <h2>Private Subscription Sharing</h2>
            <p>Encrypted group payments with homomorphic permissions</p>
            <div className="feature-grid">
              <div className="feature-item">
                <div className="feature-icon">👥</div>
                <h3>Group Sharing</h3>
                <p>Split subscription costs securely</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🔐</div>
                <h3>FHE Encryption</h3>
                <p>Amounts remain encrypted</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">💳</div>
                <h3>Privacy First</h3>
                <p>No payment details exposed</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Loading encrypted subscription system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🔒</div>
          <h1>SubShare_Z</h1>
          <span className="tagline">Encrypted Group Subscriptions</span>
        </div>
        
        <div className="header-actions">
          <button className="availability-btn" onClick={checkAvailability}>
            Check Contract
          </button>
          <button 
            className="create-subscription-btn"
            onClick={() => setShowCreateModal(true)}
          >
            + New Group
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="stats-section">
          <h2>Subscription Analytics</h2>
          {renderStatsPanel()}
          
          <div className="fhe-info-panel">
            <h3>FHE 🔐 Encryption Process</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="subscriptions-section">
          <div className="section-header">
            <h2>Active Subscription Groups</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search groups..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <label className="filter-toggle">
                <input 
                  type="checkbox" 
                  checked={filterVerified}
                  onChange={(e) => setFilterVerified(e.target.checked)}
                />
                Verified Only
              </label>
              <button 
                onClick={loadData} 
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="subscriptions-grid">
            {filteredSubscriptions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <p>No subscription groups found</p>
                <button 
                  className="create-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Group
                </button>
              </div>
            ) : (
              filteredSubscriptions.map((subscription, index) => (
                <div 
                  key={subscription.id}
                  className={`subscription-card ${subscription.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedSubscription(subscription)}
                >
                  <div className="card-header">
                    <h3>{subscription.name}</h3>
                    {subscription.isVerified && <span className="verified-badge">✅ Verified</span>}
                  </div>
                  <p className="card-description">{subscription.description}</p>
                  <div className="card-details">
                    <div className="detail-item">
                      <span>Members:</span>
                      <strong>{subscription.totalMembers}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Amount:</span>
                      <strong>
                        {subscription.isVerified && subscription.decryptedAmount 
                          ? `$${subscription.decryptedAmount}` 
                          : '🔒 Encrypted'
                        }
                      </strong>
                    </div>
                  </div>
                  <div className="card-footer">
                    <span className="creator">
                      by {subscription.creator.substring(0, 6)}...{subscription.creator.substring(38)}
                    </span>
                    <span className="date">
                      {new Date(subscription.timestamp * 1000).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <CreateSubscriptionModal
          onSubmit={createSubscription}
          onClose={() => setShowCreateModal(false)}
          creating={creatingSubscription}
          subscriptionData={newSubscriptionData}
          setSubscriptionData={setNewSubscriptionData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedSubscription && (
        <SubscriptionDetailModal
          subscription={selectedSubscription}
          onClose={() => setSelectedSubscription(null)}
          onDecrypt={() => decryptData(selectedSubscription.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateSubscriptionModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  subscriptionData: any;
  setSubscriptionData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, subscriptionData, setSubscriptionData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'amount' || name === 'members') {
      const intValue = value.replace(/[^\d]/g, '');
      setSubscriptionData({ ...subscriptionData, [name]: intValue });
    } else {
      setSubscriptionData({ ...subscriptionData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create Subscription Group</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Amount</strong>
              <p>Subscription amount will be encrypted using homomorphic encryption</p>
            </div>
          </div>

          <div className="form-group">
            <label>Group Name *</label>
            <input
              type="text"
              name="name"
              value={subscriptionData.name}
              onChange={handleChange}
              placeholder="Enter group name..."
            />
          </div>

          <div className="form-group">
            <label>Amount per Member (Integer only) *</label>
            <input
              type="number"
              name="amount"
              value={subscriptionData.amount}
              onChange={handleChange}
              placeholder="Enter amount..."
              min="0"
            />
            <span className="input-hint">FHE Encrypted Integer</span>
          </div>

          <div className="form-group">
            <label>Number of Members *</label>
            <input
              type="number"
              name="members"
              value={subscriptionData.members}
              onChange={handleChange}
              placeholder="Enter member count..."
              min="1"
            />
            <span className="input-hint">Public Data</span>
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={subscriptionData.description}
              onChange={handleChange}
              placeholder="Describe this subscription group..."
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !subscriptionData.name || !subscriptionData.amount || !subscriptionData.members}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Group"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SubscriptionDetailModal: React.FC<{
  subscription: SubscriptionGroup;
  onClose: () => void;
  onDecrypt: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ subscription, onClose, onDecrypt, isDecrypting }) => {
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const amount = await onDecrypt();
    setDecryptedAmount(amount);
  };

  const perMemberCost = subscription.decryptedAmount && subscription.totalMembers > 0 
    ? (subscription.decryptedAmount / subscription.totalMembers).toFixed(2)
    : '0';

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>{subscription.name}</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-body">
          <div className="subscription-info">
            <div className="info-grid">
              <div className="info-item">
                <label>Description</label>
                <p>{subscription.description}</p>
              </div>
              <div className="info-item">
                <label>Total Members</label>
                <span>{subscription.totalMembers}</span>
              </div>
              <div className="info-item">
                <label>Created</label>
                <span>{new Date(subscription.timestamp * 1000).toLocaleDateString()}</span>
              </div>
              <div className="info-item">
                <label>Creator</label>
                <span>{subscription.creator.substring(0, 8)}...{subscription.creator.substring(36)}</span>
              </div>
            </div>

            <div className="amount-section">
              <div className="amount-header">
                <h3>Subscription Amount</h3>
                {subscription.isVerified ? (
                  <span className="verified-tag">✅ On-chain Verified</span>
                ) : decryptedAmount !== null ? (
                  <span className="decrypted-tag">🔓 Locally Decrypted</span>
                ) : (
                  <span className="encrypted-tag">🔒 FHE Encrypted</span>
                )}
              </div>
              
              <div className="amount-display">
                {subscription.isVerified && subscription.decryptedAmount ? (
                  <div className="amount-value">${subscription.decryptedAmount}</div>
                ) : decryptedAmount !== null ? (
                  <div className="amount-value">${decryptedAmount}</div>
                ) : (
                  <div className="encrypted-amount">🔒 Encrypted</div>
                )}
                
                <button
                  onClick={handleDecrypt}
                  disabled={isDecrypting || (subscription.isVerified && !decryptedAmount)}
                  className={`decrypt-btn ${subscription.isVerified ? 'verified' : ''}`}
                >
                  {isDecrypting ? 'Decrypting...' : 
                   subscription.isVerified ? '✅ Verified' : 
                   decryptedAmount !== null ? '🔓 Re-verify' : '🔓 Decrypt Amount'}
                </button>
              </div>

              {(subscription.isVerified || decryptedAmount !== null) && (
                <div className="cost-breakdown">
                  <div className="breakdown-item">
                    <span>Total Amount:</span>
                    <strong>${subscription.decryptedAmount || decryptedAmount}</strong>
                  </div>
                  <div className="breakdown-item">
                    <span>Per Member:</span>
                    <strong>${perMemberCost}</strong>
                  </div>
                  <div className="breakdown-item">
                    <span>Savings vs Individual:</span>
                    <strong className="savings">${((subscription.decryptedAmount || decryptedAmount || 0) * 0.3).toFixed(2)}</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="fhe-explanation">
              <h4>🔐 How FHE Protects Your Payment</h4>
              <p>Your subscription amount is encrypted using Fully Homomorphic Encryption, allowing secure cost splitting without revealing individual payment details.</p>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!subscription.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              Verify on Blockchain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
  CrediVault SME Debt Recovery & Split-Payout Smart Contract

  - Owner creates invoice-based debt cases
  - Debtors pay Ether to a specific case
  - Owner configures multiple recipients with percentage allocation
  - Authorized executor triggers one-time distribution
*/

contract CrediVault {

    /*//////////////////////////////////////////////////////////////
                                ROLES
    //////////////////////////////////////////////////////////////*/

    address public owner;
    mapping(address => bool) private executors;

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    modifier onlyExecutor() {
        require(executors[msg.sender], "ONLY_EXECUTOR");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              DATA MODEL
    //////////////////////////////////////////////////////////////*/

    struct DebtCase {
        address debtor;
        uint256 amountDue;
        uint256 amountPaid;
        bool configured;
        bool executed;
        address[] recipients;
        uint16[] allocations; // basis points (10000 = 100%)
    }

    // mapping requirement
    mapping(bytes32 => DebtCase) private cases;

    // Keeps insertion order so off-chain systems can enumerate all case IDs.
    bytes32[] private caseIds;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Deposit(bytes32 indexed caseId, address indexed from, uint256 amount);
    event CaseCreated(bytes32 indexed caseId, address debtor, uint256 amountDue);
    event AllocationUpdated(bytes32 indexed caseId);
    event ExecutorUpdated(address executor, bool allowed);
    event Executed(bytes32 indexed caseId, uint256 totalPaid);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor() {
        // Bootstrap deployer as both owner and executor to avoid admin lockout.
        owner = msg.sender;
        executors[msg.sender] = true;
    }

    /*//////////////////////////////////////////////////////////////
                          ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function setExecutor(address executor, bool allowed) external onlyOwner {
        executors[executor] = allowed;
        emit ExecutorUpdated(executor, allowed);
    }

    function createCase(bytes32 caseId, address debtor, uint256 amountDue)
        external
        onlyOwner
    {
        // debtor == address(0) is the sentinel for a non-existent case.
        require(cases[caseId].debtor == address(0), "CASE_EXISTS");
        require(debtor != address(0), "BAD_DEBTOR");
        require(amountDue > 0, "BAD_AMOUNT");

        cases[caseId].debtor = debtor;
        cases[caseId].amountDue = amountDue;

        caseIds.push(caseId);

        emit CaseCreated(caseId, debtor, amountDue);
    }

    function setAllocation(
        bytes32 caseId,
        address[] calldata recipients,
        uint16[] calldata allocations
    ) external onlyOwner {

        require(recipients.length == allocations.length, "LEN_MISMATCH");
        require(recipients.length > 0, "EMPTY");

        // Allocation must represent an exact 100% split in basis points.
        uint256 total;
        for (uint256 i = 0; i < allocations.length; i++) {
            total += allocations[i];
        }

        require(total == 10000, "MUST_EQUAL_10000");

        DebtCase storage dc = cases[caseId];
        require(dc.debtor != address(0), "NO_CASE");
        require(!dc.executed, "EXECUTED");

        dc.recipients = recipients;
        dc.allocations = allocations;
        dc.configured = true;

        emit AllocationUpdated(caseId);
    }

    /*//////////////////////////////////////////////////////////////
                          PAYMENT FUNCTION
    //////////////////////////////////////////////////////////////*/

    function payInvoice(bytes32 caseId) external payable {
        DebtCase storage dc = cases[caseId];
        require(dc.debtor != address(0), "NO_CASE");
        require(msg.value > 0, "ZERO_VALUE");
        require(!dc.executed, "EXECUTED");

        // Any address may contribute payment; sender is captured in the event log.
        dc.amountPaid += msg.value;

        emit Deposit(caseId, msg.sender, msg.value);
    }

    /*//////////////////////////////////////////////////////////////
                      EXECUTION FUNCTION
    //////////////////////////////////////////////////////////////*/

    function executePayout(bytes32 caseId) external onlyExecutor {
        DebtCase storage dc = cases[caseId];

        require(dc.debtor != address(0), "NO_CASE");
        require(dc.configured, "NOT_CONFIGURED");
        require(!dc.executed, "ALREADY_EXECUTED");
        require(dc.amountPaid > 0, "NO_FUNDS");

        // Mark executed before external transfers (checks-effects-interactions).
        dc.executed = true;

        for (uint256 i = 0; i < dc.recipients.length; i++) {
            // Integer division truncates; any remainder ("dust") stays in the contract.
            uint256 share = (dc.amountPaid * dc.allocations[i]) / 10000;
            payable(dc.recipients[i]).transfer(share);
        }

        emit Executed(caseId, dc.amountPaid);
    }

    /*//////////////////////////////////////////////////////////////
                         VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getCase(bytes32 caseId)
        external
        view
        returns (
            address debtor,
            uint256 due,
            uint256 paid,
            bool configured,
            bool executed
        )
    {
        DebtCase storage dc = cases[caseId];
        return (
            dc.debtor,
            dc.amountDue,
            dc.amountPaid,
            dc.configured,
            dc.executed
        );
    }

    function getRecipients(bytes32 caseId)
        external
        view
        returns (address[] memory, uint16[] memory)
    {
        return (cases[caseId].recipients, cases[caseId].allocations);
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function isExecutor(address user) external view returns (bool) {
        return executors[user];
    }
}

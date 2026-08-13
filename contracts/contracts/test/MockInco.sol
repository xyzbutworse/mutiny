// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev Test-only semantic executor. It models encrypted operations over uint256
/// values so the MUTINY state machine can be tested without a live covalidator.
contract MockInco {
    function getFee() external pure returns (uint256) { return 0.0001 ether; }
    function asEuint256(uint256 value) external pure returns (bytes32) { return bytes32(value); }
    function asEbool(bool value) external pure returns (bytes32) { return value ? bytes32(uint256(1)) : bytes32(0); }
    function eCast(bytes32 value, uint8) external pure returns (bytes32) { return value; }
    function eAdd(bytes32 a, bytes32 b) external pure returns (bytes32) { return bytes32(uint256(a) + uint256(b)); }
    function eSub(bytes32 a, bytes32 b) external pure returns (bytes32) { return bytes32(uint256(a) - uint256(b)); }
    function eMul(bytes32 a, bytes32 b) external pure returns (bytes32) { return bytes32(uint256(a) * uint256(b)); }
    function eDiv(bytes32 a, bytes32 b) external pure returns (bytes32) { return bytes32(uint256(a) / uint256(b)); }
    function eRem(bytes32 a, bytes32 b) external pure returns (bytes32) { return bytes32(uint256(a) % uint256(b)); }
    function eBitAnd(bytes32 a, bytes32 b) external pure returns (bytes32) { return bytes32(uint256(a) & uint256(b)); }
    function eBitOr(bytes32 a, bytes32 b) external pure returns (bytes32) { return bytes32(uint256(a) | uint256(b)); }
    function eNot(bytes32 value) external pure returns (bytes32) { return uint256(value) == 0 ? bytes32(uint256(1)) : bytes32(0); }
    function eEq(bytes32 a, bytes32 b) external pure returns (bytes32) { return a == b ? bytes32(uint256(1)) : bytes32(0); }
    function eNe(bytes32 a, bytes32 b) external pure returns (bytes32) { return a != b ? bytes32(uint256(1)) : bytes32(0); }
    function eGe(bytes32 a, bytes32 b) external pure returns (bytes32) { return uint256(a) >= uint256(b) ? bytes32(uint256(1)) : bytes32(0); }
    function eGt(bytes32 a, bytes32 b) external pure returns (bytes32) { return uint256(a) > uint256(b) ? bytes32(uint256(1)) : bytes32(0); }
    function eLe(bytes32 a, bytes32 b) external pure returns (bytes32) { return uint256(a) <= uint256(b) ? bytes32(uint256(1)) : bytes32(0); }
    function eLt(bytes32 a, bytes32 b) external pure returns (bytes32) { return uint256(a) < uint256(b) ? bytes32(uint256(1)) : bytes32(0); }
    function eMin(bytes32 a, bytes32 b) external pure returns (bytes32) { return uint256(a) < uint256(b) ? a : b; }
    function eIfThenElse(bytes32 condition, bytes32 ifTrue, bytes32 ifFalse) external pure returns (bytes32) { return uint256(condition) != 0 ? ifTrue : ifFalse; }
    function eRandBounded(bytes32, uint8) external payable returns (bytes32) { return bytes32(0); }
    function allow(bytes32, address) external pure {}
    function reveal(bytes32) external pure {}
    function newEuint256(bytes calldata input, address) external payable returns (bytes32) {
        (, bytes memory ciphertext) = abi.decode(input, (bytes32, bytes));
        return bytes32(abi.decode(ciphertext, (uint256)));
    }
}

//! The program encodes its four System Program instructions itself (without bincode, which would
//! double its size); each must equal the instruction `solana-system-interface` 3.3.0 builds.

use proptest::prelude::*;
use solana_address::Address;
use solana_system_interface::instruction as crate_builder;
use sotto_proofs::processor::system;

fn address() -> impl Strategy<Value = Address> {
    any::<[u8; 32]>().prop_map(Address::new_from_array)
}

proptest! {
    #[test]
    fn equals_the_system_interface_builders(
        from in address(),
        to in address(),
        owner in address(),
        lamports: u64,
        space: u64,
    ) {
        prop_assert_eq!(
            system::create_account(&from, &to, lamports, space, &owner),
            crate_builder::create_account(&from, &to, lamports, space, &owner)
        );
        prop_assert_eq!(system::transfer(&from, &to, lamports), crate_builder::transfer(&from, &to, lamports));
        prop_assert_eq!(system::allocate(&to, space), crate_builder::allocate(&to, space));
        prop_assert_eq!(system::assign(&to, &owner), crate_builder::assign(&to, &owner));
    }
}

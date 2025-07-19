import VaultSelector from "../components/Vault/VaultSelector";
 
const HomeScreen = () => {
    return (
        <div className="flex h-screen w-screen">
            <div className="vault-selector w-1/5 h-full">
               <VaultSelector />
            </div>
            <div className="vault-content w-4/5 h-full"></div>
        </div>
    );
};
 
export default HomeScreen;
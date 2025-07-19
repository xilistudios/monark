import { Link } from "@tanstack/react-router";
import ThemeSwitcher from "../components/UI/ThemeSwitcher";

const SettingsScreen = () => {
    return (
        <div className="flex h-screen w-screen">
           <h1>Settings</h1>
           <Link to="/">Back to Home</Link>
           <hr />
           <ThemeSwitcher/>
        </div>
    );
};

export default SettingsScreen;
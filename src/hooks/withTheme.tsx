
import { useSelector } from 'react-redux';
import { useEffect } from 'react';
 
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const theme = useSelector((state: any) => state.preferences.preferences.theme);
    // loading can be removed if it is not used

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    return children
}
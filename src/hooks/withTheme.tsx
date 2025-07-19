
import { useSelector } from 'react-redux';
import { useEffect } from 'react';
 
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const theme = useSelector((state: any) => state.preferences.preferences.theme);
    // loading se puede eliminar si no se usa

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    return children
}
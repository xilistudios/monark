import { useState } from "react";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [filePath, setFilePath] = useState("");
  const [password, setPassword] = useState("");
  const [vault, setVault] = useState<any | null>(null);
  const [error, setError] = useState("");

  async function createVault() {
    setError("");
    setVault(null);
    try {
      await invoke("create_vault", { filePath, password });
      alert("Vault created successfully!");
    } catch (err) {
      console.error("Error creating vault:", err);
      setError(String(err));
    }
  }

  async function openVault() {
    setError("");
    setVault(null);
    try {
      const openedVault = await invoke("open_vault", { filePath, password });
      setVault(openedVault);
    } catch (err) {
      console.error("Error opening vault:", err);
      setError(String(err));
    }
  }
  console.log(error);
  return (
    <main className="container">
      <h1>Monark Vault</h1>

      <div className="row">
        <input
          id="path-input"
          onChange={(e) => setFilePath(e.currentTarget.value)}
          placeholder="Enter vault file path..."
          value={filePath}
        />
        <input
          id="password-input"
          type="password"
          onChange={(e) => setPassword(e.currentTarget.value)}
          placeholder="Enter password..."
          value={password}
        />
      </div>

      <div className="row">
        <button onClick={async () => {
          const result = await open({
            multiple: false,
            directory: false,
            filters: [{ name: "Monark Vault", extensions: ["monark"] }],
          });
          if (result) {
            setFilePath(result);
          }
        }}>Select vault</button>
        <button onClick={createVault}>Create Vault</button>
        <button onClick={openVault}>Open Vault</button>
      </div>

      {error && <p style={{ color: "red" }}>{JSON.stringify(error)}</p>}

      {vault && (
        <div>
          <h2>Vault Content</h2>
          <pre>{JSON.stringify(vault, null, 2)}</pre>
        </div>
      )}
    </main>
  );
}

export default App;

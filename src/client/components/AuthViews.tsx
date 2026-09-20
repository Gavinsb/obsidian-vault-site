import { useEffect, useState } from "react";
import { api, type AdminUser } from "../api";
import { useAuth } from "../auth";
export function LoginView() {
  const { user, login, logout } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  if (user)
    return (
      <div className="auth-card">
        <strong>{user.username}</strong>
        <span className="muted">({user.role})</span>
        <button onClick={() => void logout()}>Sign out</button>
      </div>
    );
  return (
    <form
      className="auth-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await login(name, password);
          setPassword("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sign in failed");
        }
      }}
    >
      <strong>Sign in to edit</strong>
      <input
        aria-label="Username"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="username"
      />
      <input
        aria-label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      <button className="primary">Sign in</button>
      {error && <span className="flash-err">{error}</span>}
    </form>
  );
}
export function UserAdminView() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const load = () =>
    api
      .users()
      .then(setUsers)
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    if (user?.role === "admin") void load();
  }, [user]);
  if (user?.role !== "admin")
    return (
      <div className="view">
        <h1>User administration</h1>
        <p>Administrator access required.</p>
      </div>
    );
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setMsg("");
    try {
      await fn();
      setMsg(success);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="view">
      <h1>User administration</h1>
      <form
        className="card admin-create"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() => api.createUser(username, password), "User created");
          setUsername("");
          setPassword("");
        }}
      >
        <h3>Create user</h3>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          placeholder="Password (12+ characters)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary">Create</button>
      </form>
      {msg && <p className="flash flash-info">{msg}</p>}
      <div className="card user-directory">
        {users.map((u) => (
          <div key={u.id} className="user-row">
            <span>
              <strong>{u.username}</strong> · {u.role} ·{" "}
              {u.active ? "active" : "inactive"}
            </span>
            <button
              onClick={() =>
                void run(
                  () => api.setUserStatus(u.id, !u.active),
                  u.active ? "User deactivated" : "User reactivated",
                )
              }
            >
              {u.active ? "Deactivate" : "Reactivate"}
            </button>
            <button
              onClick={() =>
                void run(
                  () =>
                    api.setUserRole(
                      u.id,
                      u.role === "admin" ? "user" : "admin",
                    ),
                  "Role changed",
                )
              }
            >
              {u.role === "admin" ? "Make user" : "Make admin"}
            </button>
            {resetId === u.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () => api.resetPassword(u.id, resetPassword),
                    "Password reset",
                  ).then(() => {
                    setResetId(null);
                    setResetPassword("");
                  });
                }}
              >
                <input
                  aria-label={`New password for ${u.username}`}
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="New password"
                />
                <button className="primary">Save password</button>
                <button type="button" onClick={() => setResetId(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button onClick={() => setResetId(u.id)}>Reset password</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

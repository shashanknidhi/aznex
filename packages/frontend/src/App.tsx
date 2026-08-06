import { BrowserRouter, Route, Routes } from "react-router-dom";
import { BASENAME, RequireAuth, SessionProvider } from "./auth.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { CliAuth } from "./pages/CliAuth.js";
import { GetStarted } from "./pages/GetStarted.js";
import { GithubSetup } from "./pages/GithubSetup.js";
import { Login } from "./pages/Login.js";
import { MemoryList } from "./pages/MemoryList.js";
import { MemoryView } from "./pages/MemoryView.js";
import { NotFound } from "./pages/NotFound.js";
import { OrgAdmin } from "./pages/OrgAdmin.js";
import { RepoSelect } from "./pages/RepoSelect.js";
import { SuperAdminOrgs } from "./pages/SuperAdminOrgs.js";

const authed = (element: React.ReactNode) => <RequireAuth>{element}</RequireAuth>;

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={BASENAME}>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cli-auth" element={authed(<CliAuth />)} />
            <Route path="/github/setup" element={authed(<GithubSetup />)} />
            <Route path="/get-started" element={authed(<GetStarted />)} />
            <Route path="/" element={authed(<RepoSelect />)} />
            <Route path="/org/:orgId" element={authed(<OrgAdmin />)} />
            <Route path="/admin/orgs" element={authed(<SuperAdminOrgs />)} />
            <Route path="/repo/:fingerprint" element={authed(<MemoryList />)} />
            <Route path="/memory/:id" element={authed(<MemoryView />)} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

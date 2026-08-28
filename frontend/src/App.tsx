import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Sales from "./pages/Sales";
import NouvelleVente from "./pages/NouvelleVente";
import Returns from "./pages/Returns";
import Caisse from "./pages/Caisse";
import Inventaire from "./pages/Inventaire";
import Comptabilite from "./pages/Comptabilite";
import Rapports from "./pages/Rapports";
import Proformas from "./pages/Proformas";
import Customers from "./pages/Customers";
import Suppliers from "./pages/Suppliers";
import Categories from "./pages/Categories";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import APropos from "./pages/APropos";
import Approvisionnements from "./pages/Approvisionnements";
import Commandes from "./pages/Commandes";
import Livraisons from "./pages/Livraisons";
import Droits from "./pages/Droits";

/** Home screens, in the order a user falls back to them. */
const HOME_PAGES: [string, string][] = [
  ["caisse", "/caisse"],
  ["vente_nouvelle", "/ventes/nouvelle"],
  ["produits", "/produits"],
  ["inventaire", "/inventaire"],
  ["ventes", "/ventes"],
];

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Chargement...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Where a user without access lands: the first page they may open. */
function useFallbackPath(): string {
  const { can } = useAuth();
  return HOME_PAGES.find(([right]) => can(right))?.[1] ?? "/a-propos";
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  const fallback = useFallbackPath();
  if (!isAdmin) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}

/** Page the administrator can grant or revoke role by role. */
function PermRoute({
  right,
  children,
}: {
  right: string;
  children: React.ReactNode;
}) {
  const { can } = useAuth();
  const fallback = useFallbackPath();
  if (!can(right)) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}

/** Users without the dashboard land on their own home screen. */
function HomeRoute() {
  const { can } = useAuth();
  const fallback = useFallbackPath();
  if (can("tableau_bord")) return <Dashboard />;
  return <Navigate to={fallback} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomeRoute />} />
        <Route
          path="/caisse"
          element={
            <PermRoute right="caisse">
              <Caisse />
            </PermRoute>
          }
        />
        <Route
          path="/ventes"
          element={
            <PermRoute right="ventes">
              <Sales />
            </PermRoute>
          }
        />
        <Route
          path="/ventes/nouvelle"
          element={
            <PermRoute right="vente_nouvelle">
              <NouvelleVente />
            </PermRoute>
          }
        />
        <Route
          path="/retours"
          element={
            <PermRoute right="retours">
              <Returns />
            </PermRoute>
          }
        />
        <Route
          path="/clients"
          element={
            <PermRoute right="clients">
              <Customers />
            </PermRoute>
          }
        />
        <Route
          path="/commandes"
          element={
            <PermRoute right="commandes">
              <Commandes />
            </PermRoute>
          }
        />
        <Route
          path="/approvisionnements"
          element={
            <PermRoute right="approvisionnements">
              <Approvisionnements />
            </PermRoute>
          }
        />
        <Route
          path="/livraisons"
          element={
            <PermRoute right="livraisons">
              <Livraisons />
            </PermRoute>
          }
        />
        <Route
          path="/produits"
          element={
            <PermRoute right="produits">
              <Products />
            </PermRoute>
          }
        />
        <Route
          path="/inventaire"
          element={
            <PermRoute right="inventaire">
              <Inventaire />
            </PermRoute>
          }
        />
        <Route
          path="/rapports"
          element={
            <PermRoute right="rapports">
              <Rapports />
            </PermRoute>
          }
        />
        <Route
          path="/proformas"
          element={
            <PermRoute right="proformas">
              <Proformas />
            </PermRoute>
          }
        />
        <Route
          path="/comptabilite"
          element={
            <PermRoute right="comptabilite">
              <Comptabilite />
            </PermRoute>
          }
        />
        <Route
          path="/fournisseurs"
          element={
            <PermRoute right="fournisseurs">
              <Suppliers />
            </PermRoute>
          }
        />
        <Route
          path="/categories"
          element={
            <PermRoute right="categories">
              <Categories />
            </PermRoute>
          }
        />
        <Route
          path="/utilisateurs"
          element={
            <AdminRoute>
              <Users />
            </AdminRoute>
          }
        />
        <Route
          path="/parametres"
          element={
            <AdminRoute>
              <Settings />
            </AdminRoute>
          }
        />
        <Route
          path="/droits"
          element={
            <AdminRoute>
              <Droits />
            </AdminRoute>
          }
        />
        <Route
          path="/a-propos"
          element={
            <PermRoute right="apropos">
              <APropos />
            </PermRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

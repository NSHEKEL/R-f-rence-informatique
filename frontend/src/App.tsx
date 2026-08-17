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
import Commandes from "./pages/Commandes";
import Livraisons from "./pages/Livraisons";

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

/** Where a user without access lands: their own home screen. */
function useFallbackPath(): string {
  const { isStockManager } = useAuth();
  return isStockManager ? "/produits" : "/caisse";
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  const fallback = useFallbackPath();
  if (!isAdmin) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}

/** Catalogue, stock and purchases: administrators and stock managers. */
function StockRoute({ children }: { children: React.ReactNode }) {
  const { isStockManager } = useAuth();
  if (!isStockManager) return <Navigate to="/caisse" replace />;
  return <>{children}</>;
}

/** Till and sales: administrators and cashiers, never stock managers. */
function SalesRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, isSeller } = useAuth();
  if (!isAdmin && !isSeller) return <Navigate to="/produits" replace />;
  return <>{children}</>;
}

/** Sellers have no dashboard: the till is their home screen. */
function HomeRoute() {
  const { isAdmin, isStockManager } = useAuth();
  if (isAdmin) return <Dashboard />;
  return <Navigate to={isStockManager ? "/produits" : "/caisse"} replace />;
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
            <SalesRoute>
              <Caisse />
            </SalesRoute>
          }
        />
        <Route
          path="/ventes"
          element={
            <AdminRoute>
              <Sales />
            </AdminRoute>
          }
        />
        <Route
          path="/ventes/nouvelle"
          element={
            <SalesRoute>
              <NouvelleVente />
            </SalesRoute>
          }
        />
        <Route
          path="/retours"
          element={
            <AdminRoute>
              <Returns />
            </AdminRoute>
          }
        />
        <Route
          path="/clients"
          element={
            <AdminRoute>
              <Customers />
            </AdminRoute>
          }
        />
        <Route
          path="/commandes"
          element={
            <AdminRoute>
              <Commandes />
            </AdminRoute>
          }
        />
        <Route
          path="/livraisons"
          element={
            <AdminRoute>
              <Livraisons />
            </AdminRoute>
          }
        />
        <Route
          path="/produits"
          element={
            <StockRoute>
              <Products />
            </StockRoute>
          }
        />
        <Route
          path="/inventaire"
          element={
            <StockRoute>
              <Inventaire />
            </StockRoute>
          }
        />
        <Route
          path="/rapports"
          element={
            <AdminRoute>
              <Rapports />
            </AdminRoute>
          }
        />
        <Route
          path="/proformas"
          element={
            <AdminRoute>
              <Proformas />
            </AdminRoute>
          }
        />
        <Route
          path="/comptabilite"
          element={
            <AdminRoute>
              <Comptabilite />
            </AdminRoute>
          }
        />
        <Route
          path="/fournisseurs"
          element={
            <StockRoute>
              <Suppliers />
            </StockRoute>
          }
        />
        <Route
          path="/categories"
          element={
            <StockRoute>
              <Categories />
            </StockRoute>
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
        {/* "À propos" is reserved for administrators. */}
        <Route
          path="/a-propos"
          element={
            <AdminRoute>
              <APropos />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

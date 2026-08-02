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
import Customers from "./pages/Customers";
import Suppliers from "./pages/Suppliers";
import Categories from "./pages/Categories";
import Users from "./pages/Users";
import Settings from "./pages/Settings";

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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/caisse" replace />;
  return <>{children}</>;
}

/** Sellers have no dashboard: the till is their home screen. */
function HomeRoute() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Dashboard /> : <Navigate to="/caisse" replace />;
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
        <Route path="/caisse" element={<Caisse />} />
        <Route path="/ventes" element={<Sales />} />
        <Route path="/ventes/nouvelle" element={<NouvelleVente />} />
        <Route path="/retours" element={<Returns />} />
        <Route path="/clients" element={<Customers />} />
        <Route
          path="/produits"
          element={
            <AdminRoute>
              <Products />
            </AdminRoute>
          }
        />
        <Route
          path="/inventaire"
          element={
            <AdminRoute>
              <Inventaire />
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
            <AdminRoute>
              <Suppliers />
            </AdminRoute>
          }
        />
        <Route
          path="/categories"
          element={
            <AdminRoute>
              <Categories />
            </AdminRoute>
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

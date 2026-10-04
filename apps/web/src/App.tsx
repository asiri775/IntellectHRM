import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage, ChangePasswordPage } from './pages/Login';
import { HomePage } from './pages/Home';

const AttendancePage = lazy(() => import('./pages/Attendance'));
const LeavePage = lazy(() => import('./pages/Leave'));
const EmployeesPage = lazy(() => import('./pages/Employees'));
const EmployeeDetailPage = lazy(() => import('./pages/EmployeeDetail'));
const EmployeeFormPage = lazy(() => import('./pages/EmployeeForm'));
const PayrollPage = lazy(() => import('./pages/Payroll'));
const PayrollRunPage = lazy(() => import('./pages/PayrollRun'));
const MyPayslipsPage = lazy(() => import('./pages/MyPayslips'));
const LeadsPage = lazy(() => import('./pages/crm/Leads'));
const LeadDetailPage = lazy(() => import('./pages/crm/LeadDetail'));
const PipelinePage = lazy(() => import('./pages/crm/Pipeline'));
const OpportunityPage = lazy(() => import('./pages/crm/Opportunity'));
const CustomersPage = lazy(() => import('./pages/crm/Customers'));
const CustomerDetailPage = lazy(() => import('./pages/crm/CustomerDetail'));
const SettingsPage = lazy(() => import('./pages/settings/Settings'));

function Guard({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.mustChangePassword) return <ChangePasswordPage forced />;
  return <>{children}</>;
}

export function App() {
  const { me, loading } = useAuth();
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={!loading && me ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route
          element={
            <Guard>
              <Layout />
            </Guard>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="leave/*" element={<LeavePage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/new" element={<EmployeeFormPage />} />
          <Route path="employees/:id" element={<EmployeeDetailPage />} />
          <Route path="employees/:id/edit" element={<EmployeeFormPage />} />
          <Route path="payroll" element={<PayrollPage />} />
          <Route path="payroll/runs/:id" element={<PayrollRunPage />} />
          <Route path="payroll/my-payslips" element={<MyPayslipsPage />} />
          <Route path="crm/leads" element={<LeadsPage />} />
          <Route path="crm/leads/:id" element={<LeadDetailPage />} />
          <Route path="crm/pipeline" element={<PipelinePage />} />
          <Route path="crm/opportunities/:id" element={<OpportunityPage />} />
          <Route path="crm/customers" element={<CustomersPage />} />
          <Route path="crm/customers/:id" element={<CustomerDetailPage />} />
          <Route path="settings/*" element={<SettingsPage />} />
          <Route path="account/password" element={<ChangePasswordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

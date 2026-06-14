import { AuthProvider } from '../components/AuthProvider';
import { Dashboard } from '../components/Dashboard';
import { Layout } from '../components/Layout';

export default function HomePage() {
  return (
    <AuthProvider>
      <Layout>
        <Dashboard />
      </Layout>
    </AuthProvider>
  );
}

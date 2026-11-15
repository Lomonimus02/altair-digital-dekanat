import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { Shell } from "./components/shell";
import { LoadingBlock } from "./components/ui";
import { useAuth } from "./lib/auth";
import { DashboardPage } from "./pages/dashboard";
import { GradesPage } from "./pages/grades";
import { LoginPage } from "./pages/login";
import { AuditPage, NotFoundPage, NotificationsPage, ProfilePage, RegulationsPage, StaffAnnouncePage, StaffRequestPage, VerifyPage } from "./pages/more";
import { NewRequestPage, RequestPage, RequestsPage } from "./pages/requests";
import { HomeworkDetail, HomeworkPage } from "./pages/homework";
import { SchedulePage } from "./pages/schedule";
import { TeachAnnounce, TeachAssignment, TeachHome, TeachIssue, TeachJournal, TeachQueue } from "./pages/teach";

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6"><LoadingBlock /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell />;
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify/:code" element={<VerifyPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<StudentGate><DashboardPage /></StudentGate>} />
          <Route path="/schedule" element={<LearnerGate><SchedulePage /></LearnerGate>} />
          <Route path="/grades" element={<StudentGate><GradesPage /></StudentGate>} />
          <Route path="/homework" element={<StudentGate><HomeworkPage /></StudentGate>} />
          <Route path="/homework/:id" element={<StudentGate><HomeworkDetail /></StudentGate>} />
          <Route path="/teach" element={<TeacherGate><TeachHome /></TeacherGate>} />
          <Route path="/teach/journal" element={<TeacherGate><TeachJournal /></TeacherGate>} />
          <Route path="/teach/homework" element={<TeacherGate><TeachQueue /></TeacherGate>} />
          <Route path="/teach/homework/:id" element={<TeacherGate><TeachAssignment /></TeacherGate>} />
          <Route path="/teach/assign" element={<TeacherGate><TeachIssue /></TeacherGate>} />
          <Route path="/teach/announce" element={<TeacherGate><TeachAnnounce /></TeacherGate>} />
          <Route path="/requests" element={<StudentGate><RequestsPage /></StudentGate>} />
          <Route path="/requests/new" element={<StudentGate><NewRequestPage /></StudentGate>} />
          <Route path="/requests/:id" element={<StudentGate><RequestPage /></StudentGate>} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/regulations" element={<RegulationsPage />} />
          <Route path="/staff" element={<StaffGate><DashboardPage /></StaffGate>} />
          <Route path="/staff/requests/:id" element={<StaffGate><StaffRequestPage /></StaffGate>} />
          <Route path="/staff/announcements" element={<StaffGate><StaffAnnouncePage /></StaffGate>} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster position="bottom-right" offset={16} mobileOffset={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }} />
    </>
  );
}

function StaffGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== "staff") return <Navigate to={user.role === "teacher" ? "/teach" : "/"} replace />;
  return children;
}

function LearnerGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "staff") return <Navigate to="/staff" replace />;
  return children;
}

function StudentGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "teacher") return <Navigate to="/teach" replace />;
  if (user?.role === "staff") return <Navigate to="/staff" replace />;
  return children;
}

function TeacherGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== "teacher") return <Navigate to={user.role === "staff" ? "/staff" : "/"} replace />;
  return children;
}

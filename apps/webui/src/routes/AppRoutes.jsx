import { Navigate, Route, Routes } from "react-router-dom";

import BuilderPage from "../pages/BuilderPage";
import ManagePage from "../pages/ManagePage";
import CommunityPage from "../pages/CommunityPage";
import GeneratorPage from "../pages/GeneratorPage";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/builder" replace />} />
      <Route path="/builder" element={<BuilderPage />} />
      <Route path="/manage" element={<ManagePage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="/generator" element={<GeneratorPage />} />
    </Routes>
  );
}

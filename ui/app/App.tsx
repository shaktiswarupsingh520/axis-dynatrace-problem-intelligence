import { PageLayout } from '@dynatrace/strato-components/layouts';
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { Home } from './pages/Home';
import { AlertDump } from './pages/AlertDump';
import { RcaWorkbench } from './pages/RcaWorkbench';

export const App = () => <PageLayout>
  <PageLayout.Header><Header /></PageLayout.Header>
  <PageLayout.Content><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/alert-dump" element={<AlertDump />} />
    <Route path="/rca" element={<RcaWorkbench />} />
  </Routes></PageLayout.Content>
</PageLayout>;

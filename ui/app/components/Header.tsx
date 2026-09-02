import React from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '@dynatrace/strato-components/layouts';

export const Header = () => <AppHeader>
  <AppHeader.Navigation>
    <AppHeader.Logo as={Link} to="/" />
    <AppHeader.NavigationItem as={Link} to="/">Problem Intelligence</AppHeader.NavigationItem>
  </AppHeader.Navigation>
</AppHeader>;

import { Routes } from '@angular/router';

import { ExperimentComponent } from './experiment/experiment.component';
import { OperatorComponent } from './operator/operator.component';

export const routes: Routes = [
  { path: '', component: OperatorComponent },
  { path: 'run', component: ExperimentComponent },
  { path: '**', redirectTo: '' },
];

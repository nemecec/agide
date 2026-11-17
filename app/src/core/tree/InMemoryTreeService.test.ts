import { InMemoryTreeService } from './InMemoryTreeService';
import { describeTreeServiceContract } from './treeServiceContract';

describeTreeServiceContract('InMemoryTreeService', () => new InMemoryTreeService());

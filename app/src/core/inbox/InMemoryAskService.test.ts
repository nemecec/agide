import { describeAskServiceContract } from './askServiceContract';
import { InMemoryAskService } from './InMemoryAskService';
import { InMemoryInboxService } from './InMemoryInboxService';
import { InMemoryNoticeDelivery, ScriptedDeliverySessions } from './delivery/index';
import { InMemoryTreeService } from '../tree/InMemoryTreeService';

describeAskServiceContract('InMemoryAskService', () => {
  const tree = new InMemoryTreeService();
  const inbox = new InMemoryInboxService(tree);
  const sessions = new ScriptedDeliverySessions();
  const delivery = new InMemoryNoticeDelivery(sessions);
  return { service: new InMemoryAskService({ inbox, delivery }), inbox, delivery, sessions, folderId: tree.createFolder({ title: 'P' }).id };
});

import { GridData } from './types';

export const initialGridData: GridData = {
  fields: [
    { id: 'fld_title', name: 'Task Name', type: 'text', width: 280 },
    { 
      id: 'fld_status', 
      name: 'Status', 
      type: 'singleSelect', 
      width: 140,
      options: [
        { id: 'opt_1', name: 'Todo', color: 'bg-blue-100 text-blue-800' },
        { id: 'opt_2', name: 'In Progress', color: 'bg-orange-100 text-orange-800' },
        { id: 'opt_3', name: 'Done', color: 'bg-green-100 text-green-800' },
      ]
    },
    { id: 'fld_assignee', name: 'Assignee', type: 'person', width: 140 },
    { id: 'fld_due', name: 'Due Date', type: 'date', width: 140 },
    { 
      id: 'fld_priority', 
      name: 'Priority', 
      type: 'singleSelect', 
      width: 120,
      options: [
        { id: 'opt_p1', name: 'High', color: 'bg-red-100 text-red-800' },
        { id: 'opt_p2', name: 'Medium', color: 'bg-purple-100 text-purple-800' },
        { id: 'opt_p3', name: 'Low', color: 'bg-gray-100 text-gray-800' },
      ]
    },
    { id: 'fld_done', name: 'Completed', type: 'checkbox', width: 100 },
    { id: 'fld_cost', name: 'Estimated Cost', type: 'number', width: 140 },
    { id: 'fld_link', name: 'Resource URL', type: 'url', width: 200 },
    { id: 'fld_ai', name: 'AI Summary', type: 'aiText', width: 180, prompt: '生成网址的简称首字母大写', refFields: ['fld_link'] },
    { id: 'fld_assets', name: 'Assets', type: 'attachment', width: 180 }
  ],
  records: [
    {
      id: 'rec_1',
      fld_title: 'Design new landing page',
      fld_status: 'opt_2',
      fld_assignee: 'Alice',
      fld_due: '2025-10-12',
      fld_priority: 'opt_p1',
      fld_done: false,
      fld_cost: 1500,
      fld_link: 'https://figma.com/file/xyz',
      fld_assets: [
        { id: 'att_1', name: 'mockup1.jpg', url: 'https://picsum.photos/seed/1/200/200' },
        { id: 'att_2', name: 'logo.png', url: 'https://picsum.photos/seed/2/200/200' }
      ]
    },
    {
      id: 'rec_2',
      fld_title: 'Implement authentication',
      fld_status: 'opt_1',
      fld_assignee: 'Bob',
      fld_due: '2025-10-15',
      fld_priority: 'opt_p1',
      fld_done: false,
      fld_cost: 3000,
      fld_link: 'https://github.com/issues/42',
      fld_assets: []
    },
    {
      id: 'rec_3',
      fld_title: 'Update documentation',
      fld_status: 'opt_3',
      fld_assignee: 'Charlie',
      fld_due: '2025-09-30',
      fld_priority: 'opt_p3',
      fld_done: true,
      fld_cost: 200,
      fld_link: 'https://docs.myproduct.com',
      fld_assets: [
        { id: 'att_3', name: 'schema.png', url: 'https://picsum.photos/seed/3/200/200' }
      ]
    },
    {
      id: 'rec_4',
      fld_title: 'Fix responsive layout bugs',
      fld_status: 'opt_2',
      fld_assignee: 'Alice',
      fld_due: '2025-10-05',
      fld_priority: 'opt_p2',
      fld_done: false,
      fld_cost: 800,
      fld_link: ''
    },
    {
      id: 'rec_5',
      fld_title: 'Prepare Q3 presentation',
      fld_status: 'opt_1',
      fld_assignee: 'David',
      fld_due: '2025-10-20',
      fld_priority: 'opt_p1',
      fld_done: false,
      fld_cost: null,
      fld_link: 'https://slides.new'
    }
  ]
};

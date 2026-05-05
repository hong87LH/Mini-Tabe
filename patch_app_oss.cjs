const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Add collapsedProviders state
content = content.replace(
  "const [autoSaveSettings, setAutoSaveSettings] = useState(() => {",
  "const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());\n\n  const [autoSaveSettings, setAutoSaveSettings] = useState(() => {"
);

// Map over ui and replace the provider rendering
const uiOld = `                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                         <div>
                           <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Name / Identifier' : '显示名称标识'}</label>
                           <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500" value={provider.name} onChange={e => {
                               const newProviders = [...modelSettings.providers];
                               newProviders[idx].name = e.target.value;
                               setModelSettings(prev => ({ ...prev, providers: newProviders }));
                           }} />
                         </div>
                         <div className="flex gap-2">
                             <div className="flex-1">
                               <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Type' : '类型'}</label>
                               <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 bg-white" value={provider.type} onChange={e => {
                                   const newProviders = [...modelSettings.providers];
                                   newProviders[idx].type = e.target.value;
                                   setModelSettings(prev => ({ ...prev, providers: newProviders }));
                               }}>
                                 <option value="text">{lang === 'en' ? 'Text (LLM)' : '文本生成'}</option>
                                 <option value="image">{lang === 'en' ? 'Image Generation' : '图片生成'}</option>
                                 <option value="video">{lang === 'en' ? 'Video Generation' : '视频生成'}</option>
                               </select>
                             </div>
                             <div className="flex-1">
                               <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Protocol' : '兼容协议'}</label>
                               <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 bg-white" value={provider.protocol} onChange={e => {
                                   const newProviders = [...modelSettings.providers];
                                   newProviders[idx].protocol = e.target.value;
                                   setModelSettings(prev => ({ ...prev, providers: newProviders }));
                               }}>
                                 <option value="openai">OpenAI Compatible</option>
                                 <option value="gemini">Gemini (Google AI Studio)</option>
                                 <option value="gemini-custom">Gemini (Proxied API)</option>
                               </select>
                             </div>
                         </div>
                       </div>

                       <div className="mb-4">
                         <label className="block text-xs font-medium text-gray-500 mb-1">API Endpoint</label>
                         <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={provider.endpoint} onChange={e => {
                               const newProviders = [...modelSettings.providers];
                               newProviders[idx].endpoint = e.target.value;
                               setModelSettings(prev => ({ ...prev, providers: newProviders }));
                         }} placeholder={provider.protocol === 'openai' ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com/v1beta/models/...'} />
                       </div>

                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                           <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Avail. Models (Comma separated)' : '支持的模型 (逗号分隔)'}</label>
                           <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={provider.models} onChange={e => {
                               const newProviders = [...modelSettings.providers];
                               newProviders[idx].models = e.target.value;
                               setModelSettings(prev => ({ ...prev, providers: newProviders }));
                           }} placeholder="gpt-4o, dall-e-3, etc." />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
                           <input type="password" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={provider.key} onChange={e => {
                               const newProviders = [...modelSettings.providers];
                               newProviders[idx].key = e.target.value;
                               setModelSettings(prev => ({ ...prev, providers: newProviders }));
                           }} placeholder="sk-..." />
                         </div>
                       </div>`;

const uiNew = `                       <button 
                         onClick={(e) => {
                             e.stopPropagation();
                             setCollapsedProviders(prev => {
                                const next = new Set(prev);
                                if (next.has(provider.id)) next.delete(provider.id);
                                else next.add(provider.id);
                                return next;
                             });
                         }}
                         className="absolute top-2 right-12 p-1 text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-blue-50 z-10"
                         title={lang === 'en' ? 'Toggle Collapse' : '折叠/展开'}
                       >
                         <ChevronDown className={\`w-4 h-4 transition-transform \${collapsedProviders.has(provider.id) ? 'rotate-180' : ''}\`}/>
                       </button>

                       <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-2">
                         <div className="md:col-span-2">
                           <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Name / Identifier' : '显示名称标识'}</label>
                           <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500" value={provider.name} onChange={e => {
                               const newProviders = [...modelSettings.providers];
                               newProviders[idx].name = e.target.value;
                               setModelSettings(prev => ({ ...prev, providers: newProviders }));
                           }} />
                         </div>
                         <div className="md:col-span-1">
                           <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Type' : '类型'}</label>
                           <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 bg-white" value={provider.type} onChange={e => {
                               const newProviders = [...modelSettings.providers];
                               newProviders[idx].type = e.target.value;
                               setModelSettings(prev => ({ ...prev, providers: newProviders }));
                           }}>
                             <option value="text">{lang === 'en' ? 'Text (LLM)' : '文本生成'}</option>
                             <option value="image">{lang === 'en' ? 'Image Generation' : '图片生成'}</option>
                             <option value="video">{lang === 'en' ? 'Video Generation' : '视频生成'}</option>
                           </select>
                         </div>
                         <div className="md:col-span-2">
                           <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Protocol' : '兼容协议'}</label>
                           <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 bg-white" value={provider.protocol} onChange={e => {
                               const newProviders = [...modelSettings.providers];
                               newProviders[idx].protocol = e.target.value;
                               setModelSettings(prev => ({ ...prev, providers: newProviders }));
                           }}>
                             <option value="openai">OpenAI Compatible</option>
                             <option value="gemini">Gemini (Google AI Studio)</option>
                             <option value="gemini-custom">Gemini (Proxied API)</option>
                           </select>
                         </div>
                       </div>

                       {!collapsedProviders.has(provider.id) && (
                         <>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                             <div>
                               <label className="block text-xs font-medium text-gray-500 mb-1">API Endpoint</label>
                               <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={provider.endpoint} onChange={e => {
                                     const newProviders = [...modelSettings.providers];
                                     newProviders[idx].endpoint = e.target.value;
                                     setModelSettings(prev => ({ ...prev, providers: newProviders }));
                               }} placeholder={provider.protocol === 'openai' ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com/v1beta/models/...'} />
                             </div>
                             <div>
                               <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
                               <input type="password" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={provider.key} onChange={e => {
                                   const newProviders = [...modelSettings.providers];
                                   newProviders[idx].key = e.target.value;
                                   setModelSettings(prev => ({ ...prev, providers: newProviders }));
                               }} placeholder="sk-..." />
                             </div>
                           </div>

                           <div>
                             <label className="block text-xs font-medium text-gray-500 mb-1">{lang === 'en' ? 'Avail. Models (Comma separated)' : '支持的模型 (逗号分隔)'}</label>
                             <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={provider.models} onChange={e => {
                                 const newProviders = [...modelSettings.providers];
                                 newProviders[idx].models = e.target.value;
                                 setModelSettings(prev => ({ ...prev, providers: newProviders }));
                             }} placeholder="gpt-4o, dall-e-3, etc." />
                           </div>
                         </>
                       )}`;

content = content.replace(uiOld.trim(), uiNew.trim());

const ossUiStr = `                  <div className="mt-6 mb-6 pt-6 border-t border-gray-200">
                    <h3 className="font-semibold text-gray-700 mb-4">{lang === 'en' ? 'OSS Configuration (Optional)' : 'OSS 视频存储配置 (可选)'}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Access Key ID</label>
                        <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={modelSettings.oss?.accessKeyId || ''} onChange={e => setModelSettings(prev => ({ ...prev, oss: { ...prev.oss, accessKeyId: e.target.value } }))} placeholder="LTAI..." />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Access Key Secret</label>
                        <input type="password" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={modelSettings.oss?.accessKeySecret || ''} onChange={e => setModelSettings(prev => ({ ...prev, oss: { ...prev.oss, accessKeySecret: e.target.value } }))} placeholder="..." />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Endpoint</label>
                        <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={modelSettings.oss?.endpoint || ''} onChange={e => setModelSettings(prev => ({ ...prev, oss: { ...prev.oss, endpoint: e.target.value } }))} placeholder="https://oss-cn-beijing.aliyuncs.com" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Bucket</label>
                        <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={modelSettings.oss?.bucket || ''} onChange={e => setModelSettings(prev => ({ ...prev, oss: { ...prev.oss, bucket: e.target.value } }))} />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Custom Domain / CDNs (Optional)</label>
                        <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500 font-mono" value={modelSettings.oss?.domain || ''} onChange={e => setModelSettings(prev => ({ ...prev, oss: { ...prev.oss, domain: e.target.value } }))} placeholder="https://yourbucket.oss-cn-beijing.aliyuncs.com" />
                      </div>
                    </div>
                  </div>`;

// Insert the OSS str right before <hr className="my-6 border-gray-200" /> which follows the providers list
content = content.replace(
  `               </div>\n            </div>\n\n            <hr className="my-6 border-gray-200" />`,
  `               </div>\n${ossUiStr}\n            </div>\n\n            <hr className="my-6 border-gray-200" />`
);

fs.writeFileSync('src/App.tsx', content);

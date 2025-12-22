# 地图坐标系统迁移指南

## 修改内容总结 (v4.3)

### 地图服务切换
- **原来**: OpenStreetMap / CARTO (国际服务，中国被墙)
- **现在**: 高德地图 (中国本土服务，稳定可靠)

### 交互模式优化
按照 "地图是背景，门店是主角" 的产品理念：

| 功能 | v4.2 | v4.3 |
|------|------|------|
| 用户缩放 | ✅ 允许 | ❌ 禁用 |
| 用户拖动 | ✅ 允许 | ❌ 禁用 |
| 滚轮缩放 | ✅ 允许 | ❌ 禁用 |
| 双击缩放 | ✅ 允许 | ❌ 禁用 |
| 移动端捏合缩放 | ✅ 允许 | ❌ 禁用 |
| 点击餐厅头像 | ✅ 支持 | ✅ 支持 |
| Edge indicators导航 | ✅ 支持 | ✅ 支持 |
| 地图瓦片请求 | 动态加载 | 固定视图，一次性加载 |

**优势**：
- ✅ 减少tile API请求（用户无法缩放/拖动）
- ✅ 流畅体验（无需等待瓦片加载）
- ✅ 突出门店主体（地图纯背景）
- ✅ 移动端友好（无误触缩放）

---

## ⚠️ 关键：坐标系统问题

### 中国地图坐标系对比

| 坐标系 | 使用方 | 偏移情况 | 推荐度 |
|--------|--------|----------|--------|
| **WGS-84** | GPS标准、国际地图 | 无偏移（真实坐标） | - |
| **GCJ-02** | 高德、腾讯、谷歌中国 | 偏移50-500米（火星坐标系） | ⭐⭐⭐⭐⭐ |
| **BD-09** | 百度地图独有 | 偏移100-600米（二次加密） | ❌ |
| **CGCS2000** | 天地图 | 接近WGS-84 | ⭐⭐⭐⭐ |

### 当前问题分析

如果你之前使用**百度地图定位器**获取坐标：

```
百度定位器 → BD-09坐标 → 导入数据库 → 高德地图显示 → ❌ 偏移100-600米
```

**解决方案**：使用高德地图坐标拾取器重新定位所有门店。

---

## 推荐工具：高德地图坐标拾取器

### 网址
```
https://lbs.amap.com/tools/picker
```

### 使用步骤

1. **打开坐标拾取器**
   - 访问 https://lbs.amap.com/tools/picker
   - 无需注册，直接使用

2. **搜索门店地址**
   - 在搜索框输入门店地址（例如："成都市锦江区春熙路"）
   - 点击搜索结果，地图自动定位

3. **精确调整位置**
   - 拖动红色标记到门店精确位置
   - 地图会实时显示坐标

4. **复制坐标**
   - 右侧显示格式：`104.123456, 30.654321` (经度, 纬度)
   - 注意：高德显示的是 **GCJ-02坐标**

5. **导入数据库**
   ```sql
   UPDATE master_restaurant
   SET latitude = 30.654321,
       longitude = 104.123456
   WHERE id = 'xxx-xxx-xxx';
   ```

### 批量定位建议

创建Excel表格记录：

| restaurant_id | restaurant_name | 地址 | latitude | longitude | 备注 |
|---------------|-----------------|------|----------|-----------|------|
| uuid-1 | 野百灵春熙路店 | 成都市锦江区春熙路123号 | 30.654321 | 104.123456 | ✅ |
| uuid-2 | 野百灵天府广场店 | 成都市青羊区天府广场88号 | 30.661234 | 104.081234 | ✅ |

---

## 坐标系转换（如果已有WGS-84坐标）

如果你已经有准确的WGS-84坐标（如GPS设备采集），可以使用转换工具：

### 在线转换工具
- **国测局坐标转换工具**: http://epsg.io/transform
- **gcoord在线转换**: https://github.com/hujiulong/gcoord

### 编程转换（如果需要批量转换）

```bash
npm install gcoord
```

```javascript
const gcoord = require('gcoord');

// WGS-84 → GCJ-02
const [lng, lat] = gcoord.transform(
  [104.064, 30.656],  // 原始WGS-84坐标
  gcoord.WGS84,       // 源坐标系
  gcoord.GCJ02        // 目标坐标系（高德）
);

console.log(`转换后: ${lng}, ${lat}`);
// 输出: 104.069123, 30.659234 (示例)
```

---

## 其他中国地图服务选项

如果高德地图不满意，可以尝试：

### 1. 天地图 (MapWorld)
```javascript
L.tileLayer.chinaProvider('TianDiTu.Normal.Map', {
    key: 'YOUR_TIANDITU_API_KEY',  // 需要注册
    maxZoom: 18
}).addTo(this.map);
```

**优势**：
- ✅ 使用CGCS2000坐标系（接近WGS-84，偏移最小）
- ✅ 政府服务，稳定可靠
- ❌ 需要+86手机号注册API key

### 2. 腾讯地图
```javascript
L.tileLayer.chinaProvider('Tencent.Normal.Map', {
    maxZoom: 18
}).addTo(this.map);
```

**优势**：
- ✅ 使用GCJ-02坐标系（与高德兼容）
- ✅ 无需API key
- ❌ 地图样式不如高德清晰

---

## 测试清单

完成坐标更新后，请测试：

- [ ] 所有门店标记显示在正确位置（不在海里、不在郊外）
- [ ] 门店名称与实际位置匹配
- [ ] 地图瓦片正常加载（无ERR_CONNECTION_RESET错误）
- [ ] 无法手动缩放地图（符合预期）
- [ ] 无法拖动地图（符合预期）
- [ ] 点击餐厅头像正常触发功能
- [ ] Edge indicators（屏幕外餐厅指示器）正常工作

---

## 文件修改记录

### 修改的文件
1. `src/pages/main.html:13` - 添加leaflet.chinatmsproviders库
2. `src/pages/main.html:15` - 更新版本注释为v4.3
3. `src/pages/main.html:641-656` - 隐藏recenter按钮（固定视图下无用）
4. `src/js/map.js:2` - 更新版本注释和设计理念
5. `src/js/map.js:54-67` - 禁用所有地图交互（dragging, zoom等）
6. `src/js/map.js:69-74` - 切换到高德地图瓦片服务

### 配置变更
```javascript
// 禁用的交互功能
{
    zoomControl: false,      // 隐藏缩放按钮
    dragging: false,         // 禁止拖动
    touchZoom: false,        // 禁止触摸缩放
    scrollWheelZoom: false,  // 禁止滚轮缩放
    doubleClickZoom: false,  // 禁止双击缩放
    boxZoom: false,          // 禁止框选缩放
    keyboard: false,         // 禁止键盘控制
    minZoom: initialZoom,    // 固定缩放级别
    maxZoom: initialZoom     // 固定缩放级别
}
```

---

## FAQ

### Q1: 为什么不用静态地图图片？
A: 静态图片无法支持marker交互（点击头像、edge indicators导航）。Leaflet固定视图保留了交互能力，同时避免了动态tile请求。

### Q2: 如果未来需要缩放功能怎么办？
A: 只需修改`src/js/map.js:54-67`的配置，将`dragging`、`touchZoom`等改为`true`即可。

### Q3: 高德地图有使用限额吗？
A: leaflet.chinatmsproviders使用的是高德公开瓦片服务，无需API key，无限额限制。

### Q4: 坐标偏移问题能通过算法自动修正吗？
A: 理论上可以，但GCJ-02加密算法复杂（涉及国家安全），建议直接使用高德坐标拾取器重新定位。

### Q5: 为什么不选天地图？
A: 天地图需要注册API key（需要+86手机号），高德无需注册即可使用。如果你需要最接近WGS-84的坐标系，可以考虑天地图。

---

## 下一步行动

1. ✅ 代码已完成修改
2. ⏳ **使用高德坐标拾取器重新定位所有门店**
3. ⏳ 更新数据库中的latitude/longitude字段
4. ⏳ 测试应用，验证坐标准确性
5. ⏳ 删除recenter相关CSS样式（可选清理）

---

## 技术支持

如有问题，请检查：
1. 浏览器控制台是否有JavaScript错误
2. 网络请求是否被拦截（检查webapiv.amap.com域名）
3. 数据库中latitude/longitude字段是否有效数值

2025-12-22

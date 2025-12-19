import { Post, UserProfile } from './types';

export const INITIAL_USER_PROFILE: UserProfile = {
  id: 'user_001',
  name: 'Alex Chen',
  bio: 'Community College Student aiming for UCB CS transfer. Interested in AI and Research.',
  likeTags: ['社区大学', 'UCB转学', '科研项目', 'AI学习', '计算机科学'],
  dislikeTags: [], // Initially empty
};

export const MOCK_POSTS: Post[] = [
  {
    id: '1',
    title: 'GPA 2.0 也能上 UCB？这个冷门路径没人知道！',
    content: '只要选对课，加上这几个特殊操作，低分也能逆袭名校...',
    author: '留学咨询小助手',
    tags: ['GPA逆袭鸡汤', '低门槛留学', '社区大学'],
    imageUrl: 'https://picsum.photos/400/300?random=1',
    likes: 120,
  },
  {
    id: '2',
    title: '英语基础差？60分也能逆袭藤校的秘密',
    content: '别让语言成绩成为你的绊脚石，看看他是如何做到的...',
    author: '雅思托福保过',
    tags: ['低英语水平', 'GPA逆袭鸡汤', '英语培训'],
    imageUrl: 'https://picsum.photos/400/300?random=2',
    likes: 45,
  },
  {
    id: '3',
    title: '如何从零开始做一个 AI 推荐系统独立项目',
    content: '本文详细拆解了推荐系统的协同过滤与深度学习模型实现...',
    author: 'TechLead 杰哥',
    tags: ['AI学习', '科研项目', '计算机科学', '项目实战'],
    imageUrl: 'https://picsum.photos/400/300?random=3',
    likes: 890,
  },
  {
    id: '4',
    title: '2025年 CC 转学 UC 系统全攻略（含Tag协议细节）',
    content: '详细解读最新转学政策，Assist.org 的正确用法...',
    author: '转学小百科',
    tags: ['社区大学', 'UCB转学', '干货教程'],
    imageUrl: 'https://picsum.photos/400/300?random=4',
    likes: 1200,
  },
  {
    id: '5',
    title: 'UCB 教授最喜欢什么样的本科科研经历？',
    content: '采访了 EECS 系的招生官，他们看重这三点能力...',
    author: '伯克利学姐',
    tags: ['UCB转学', '科研项目', '面试技巧'],
    imageUrl: 'https://picsum.photos/400/300?random=5',
    likes: 560,
  },
  {
    id: '6',
    title: '震惊！这个社区大学通过率高达90%',
    content: '快来看看是不是你的学校，水课名单大公开...',
    author: '留学情报局',
    tags: ['社区大学', '水贴', '八卦'],
    imageUrl: 'https://picsum.photos/400/300?random=6',
    likes: 200,
  },
  {
    id: '7',
    title: 'Transformer 架构详解与 PyTorch 实现',
    content: '手把手教你写 Attention 机制，适合新手入门...',
    author: 'AI 研习社',
    tags: ['AI学习', '计算机科学', '硬核技术'],
    imageUrl: 'https://picsum.photos/400/300?random=7',
    likes: 430,
  },
  {
    id: '8',
    title: '我的托福备考血泪史：从 80 到 110',
    content: '真实的备考经验分享，没有任何广...',
    author: 'StudyWithMe',
    tags: ['英语学习', '经验分享', '高分攻略'],
    imageUrl: 'https://picsum.photos/400/300?random=8',
    likes: 310,
  }
];

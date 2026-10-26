#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
冒泡排序算法实现
时间复杂度：O(n²)
空间复杂度：O(1)
稳定性：稳定
"""

def bubble_sort(arr):
    """
    冒泡排序：重复地遍历列表，比较相邻元素并交换位置
    较大的元素会像气泡一样慢慢上浮到末尾
    
    Args:
        arr: 待排序的列表
    Returns:
        排序后的新列表
    """
    n = len(arr)
    # 创建副本避免修改原数组
    result = arr.copy()
    
    for i in range(n):
        # 标记是否发生交换，用于优化
        swapped = False
        # 最后 i 个元素已经排好序，不需要再比较
        for j in range(0, n - i - 1):
            if result[j] > result[j + 1]:
                # 交换相邻元素
                result[j], result[j + 1] = result[j + 1], result[j]
                swapped = True
        
        # 如果没有发生交换，说明已经有序
        if not swapped:
            break
    
    return result


def bubble_sort_with_print(arr):
    """
    带打印过程的冒泡排序（用于教学演示）
    
    Args:
        arr: 待排序的列表
    Returns:
        排序后的新列表
    """
    n = len(arr)
    result = arr.copy()
    
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if result[j] > result[j + 1]:
                result[j], result[j + 1] = result[j + 1], result[j]
                swapped = True
        
        print(f"第 {i+1} 轮排序后：{result}")
    
    return result


if __name__ == "__main__":
    # 测试示例
    test_data = [64, 34, 25, 12, 22, 11, 90]
    print(f"原始数据：{test_data}")
    sorted_data = bubble_sort(test_data)
    print(f"排序结果：{sorted_data}")
